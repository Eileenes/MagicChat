package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

const (
	defaultASRModelRealtimeURL = "wss://asrmodel.app.baizhi.cloud/openapi/v1/realtime"
	asrDialTimeout             = 10 * time.Second
	asrReadyTimeout            = 10 * time.Second
	asrCompletionTimeout       = 30 * time.Second
	asrSessionTimeout          = 105 * time.Second
	maxASRClientMessageBytes   = 64 * 1024
	maxASRSessionPCMBytes      = 16_000 * 2 * 62
)

var asrSessionStartMessage = []byte(`{"type":"session.start","task":"speech-to-text"}`)
var asrInputCommitMessage = []byte(`{"type":"input.commit"}`)

type asrUpstreamEvent struct {
	Type         string `json:"type"`
	SessionID    string `json:"session_id"`
	Task         string `json:"task"`
	SegmentID    string `json:"segment_id"`
	SegmentIndex int    `json:"segment_index"`
	Text         string `json:"text"`
	Code         string `json:"code"`
	Message      string `json:"message"`
}

type asrClientEvent struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

type asrTranscriptSegment struct {
	Index int
	Text  string
}

func (s *Server) clientASRWebSocket(c echo.Context) error {
	if _, ok := currentUser(c); !ok {
		return failure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}

	client, err := clientWebSocketUpgrader.Upgrade(c.Response().Writer, c.Request(), nil)
	if err != nil {
		return err
	}
	defer client.Close()

	upstreamURL := s.asrRealtimeURL
	if upstreamURL == "" {
		upstreamURL = defaultASRModelRealtimeURL
	}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+strings.TrimSpace(s.cfg.ASRModel.APIKey))
	dialContext, cancelDial := context.WithTimeout(c.Request().Context(), asrDialTimeout)
	defer cancelDial()
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = asrDialTimeout
	upstream, response, err := dialer.DialContext(dialContext, upstreamURL, headers)
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	if err != nil {
		_ = client.WriteJSON(asrClientEvent{Type: "error", Message: "语音识别服务连接失败"})
		return nil
	}
	defer upstream.Close()

	if err := upstream.WriteMessage(websocket.TextMessage, asrSessionStartMessage); err != nil {
		_ = client.WriteJSON(asrClientEvent{Type: "error", Message: "语音识别会话启动失败"})
		return nil
	}
	return relayASRSession(client, upstream)
}

func relayASRSession(client, upstream *websocket.Conn) error {
	client.SetReadLimit(maxASRClientMessageBytes)
	var ready atomic.Bool
	var committed atomic.Bool
	done := make(chan struct{})
	defer close(done)

	readyTimeout := time.AfterFunc(asrReadyTimeout, func() {
		if !ready.Load() {
			_ = upstream.Close()
		}
	})
	defer readyTimeout.Stop()
	sessionTimeout := time.AfterFunc(asrSessionTimeout, func() { _ = upstream.Close() })
	defer sessionTimeout.Stop()

	clientResult := make(chan error, 1)
	commitSent := make(chan struct{}, 1)
	go func() {
		clientResult <- forwardASRClientMessages(client, upstream, &ready, &committed, commitSent)
		_ = upstream.Close()
	}()

	go func() {
		select {
		case <-commitSent:
			timer := time.NewTimer(asrCompletionTimeout)
			defer timer.Stop()
			select {
			case <-timer.C:
				_ = upstream.Close()
			case <-done:
			}
		case <-done:
		}
	}()

	segments := make(map[string]asrTranscriptSegment)
	for {
		messageType, payload, err := upstream.ReadMessage()
		if err != nil {
			select {
			case clientErr := <-clientResult:
				if clientErr != nil && !websocket.IsCloseError(clientErr, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					_ = client.WriteJSON(asrClientEvent{Type: "error", Message: clientErr.Error()})
				}
			default:
				_ = client.WriteJSON(asrClientEvent{Type: "error", Message: "语音识别连接已断开"})
			}
			return nil
		}
		if messageType != websocket.TextMessage {
			continue
		}

		var event asrUpstreamEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			_ = client.WriteJSON(asrClientEvent{Type: "error", Message: "语音识别服务返回了无效数据"})
			return nil
		}
		switch event.Type {
		case "session.created":
			if ready.Swap(true) {
				continue
			}
			readyTimeout.Stop()
			if err := client.WriteJSON(asrClientEvent{Type: "ready"}); err != nil {
				return nil
			}
		case "transcript.delta", "transcript.final":
			if event.SegmentID == "" {
				continue
			}
			segments[event.SegmentID] = asrTranscriptSegment{Index: event.SegmentIndex, Text: event.Text}
			if err := client.WriteJSON(asrClientEvent{Type: "transcript", Text: assembleASRTranscript(segments)}); err != nil {
				return nil
			}
		case "session.completed":
			_ = client.WriteJSON(asrClientEvent{Type: "completed", Text: assembleASRTranscript(segments)})
			return nil
		case "error":
			message := strings.TrimSpace(event.Message)
			if message == "" {
				message = "语音识别失败"
			}
			_ = client.WriteJSON(asrClientEvent{Type: "error", Message: message})
			return nil
		}
	}
}

func forwardASRClientMessages(
	client, upstream *websocket.Conn,
	ready, committed *atomic.Bool,
	commitSent chan<- struct{},
) error {
	audioBytes := 0
	for {
		messageType, payload, err := client.ReadMessage()
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				return errors.New("语音数据帧过大")
			}
			return err
		}
		switch messageType {
		case websocket.BinaryMessage:
			if !ready.Load() {
				return errors.New("语音识别尚未准备好")
			}
			if committed.Load() {
				return errors.New("语音识别已经提交")
			}
			if len(payload) == 0 || len(payload)%2 != 0 {
				return errors.New("语音数据格式错误")
			}
			audioBytes += len(payload)
			if audioBytes > maxASRSessionPCMBytes {
				return errors.New("语音数据超过允许长度")
			}
			if err := upstream.WriteMessage(websocket.BinaryMessage, payload); err != nil {
				return err
			}
		case websocket.TextMessage:
			var control struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(payload, &control) != nil || control.Type != "commit" {
				return errors.New("语音识别控制消息无效")
			}
			if audioBytes == 0 {
				return errors.New("没有可识别的语音数据")
			}
			if committed.Swap(true) {
				return errors.New("语音识别只能提交一次")
			}
			if err := upstream.WriteMessage(websocket.TextMessage, asrInputCommitMessage); err != nil {
				return err
			}
			select {
			case commitSent <- struct{}{}:
			default:
			}
		default:
			return errors.New("不支持的语音识别消息类型")
		}
	}
}

func assembleASRTranscript(segments map[string]asrTranscriptSegment) string {
	ordered := make([]asrTranscriptSegment, 0, len(segments))
	for _, segment := range segments {
		ordered = append(ordered, segment)
	}
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Index < ordered[j].Index })
	var builder strings.Builder
	for _, segment := range ordered {
		builder.WriteString(segment.Text)
	}
	return strings.TrimSpace(builder.String())
}
