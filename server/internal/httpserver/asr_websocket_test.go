package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/config"
	"app/internal/store"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

func TestASRRealtimeProxyRelaysPCMAndAssemblesTranscript(t *testing.T) {
	upstreamDone := make(chan struct{})
	upstream := newASRUpstreamServer(t, func(conn *websocket.Conn, request *http.Request) {
		defer close(upstreamDone)
		if got := request.Header.Get("Authorization"); got != "Bearer secret-api-key" {
			t.Errorf("Authorization = %q", got)
		}
		requireASRSessionStart(t, conn)
		writeASRUpstreamEvent(t, conn, map[string]any{
			"type": "session.created", "session_id": "session-1", "task": "speech-to-text",
		})

		messageType, firstAudio, err := conn.ReadMessage()
		if err != nil || messageType != websocket.BinaryMessage || !bytes.Equal(firstAudio, []byte{1, 0, 2, 0}) {
			t.Errorf("first audio = %d/%v/%v", messageType, firstAudio, err)
			return
		}
		messageType, secondAudio, err := conn.ReadMessage()
		if err != nil || messageType != websocket.BinaryMessage || !bytes.Equal(secondAudio, []byte{3, 0}) {
			t.Errorf("second audio = %d/%v/%v", messageType, secondAudio, err)
			return
		}
		messageType, commit, err := conn.ReadMessage()
		if err != nil || messageType != websocket.TextMessage || !bytes.Equal(commit, asrInputCommitMessage) {
			t.Errorf("commit = %d/%s/%v", messageType, commit, err)
			return
		}

		writeASRUpstreamEvent(t, conn, map[string]any{
			"type": "transcript.delta", "segment_id": "segment-2", "segment_index": 2, "text": "世界",
		})
		writeASRUpstreamEvent(t, conn, map[string]any{
			"type": "transcript.delta", "segment_id": "segment-1", "segment_index": 1, "text": "你",
		})
		writeASRUpstreamEvent(t, conn, map[string]any{
			"type": "transcript.final", "segment_id": "segment-1", "segment_index": 1, "text": "你好",
		})
		writeASRUpstreamEvent(t, conn, map[string]any{"type": "session.completed"})
	})
	defer upstream.Close()

	proxy := newASRProxyTestServer(t, upstream.URL, "secret-api-key")
	defer proxy.Close()
	client := dialASRProxy(t, proxy.URL)
	defer client.Close()

	requireASRClientEvent(t, client, "ready", "")
	if err := client.WriteMessage(websocket.BinaryMessage, []byte{1, 0, 2, 0}); err != nil {
		t.Fatalf("write first audio: %v", err)
	}
	if err := client.WriteMessage(websocket.BinaryMessage, []byte{3, 0}); err != nil {
		t.Fatalf("write second audio: %v", err)
	}
	if err := client.WriteJSON(map[string]string{"type": "commit"}); err != nil {
		t.Fatalf("write commit: %v", err)
	}

	requireASRClientEvent(t, client, "transcript", "世界")
	requireASRClientEvent(t, client, "transcript", "你世界")
	requireASRClientEvent(t, client, "transcript", "你好世界")
	requireASRClientEvent(t, client, "completed", "你好世界")
	select {
	case <-upstreamDone:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream session was not cleaned up")
	}
}

func TestASRRealtimeProxyWaitsForSessionCreated(t *testing.T) {
	upstream := newASRUpstreamServer(t, func(conn *websocket.Conn, _ *http.Request) {
		requireASRSessionStart(t, conn)
		_, _, _ = conn.ReadMessage()
	})
	defer upstream.Close()
	proxy := newASRProxyTestServer(t, upstream.URL, "secret-api-key")
	defer proxy.Close()
	client := dialASRProxy(t, proxy.URL)
	defer client.Close()

	if err := client.WriteMessage(websocket.BinaryMessage, []byte{1, 0}); err != nil {
		t.Fatalf("write premature audio: %v", err)
	}
	event := requireASRClientEvent(t, client, "error", "")
	if !strings.Contains(event.Message, "尚未准备好") {
		t.Fatalf("error message = %q", event.Message)
	}
}

func TestASRRealtimeProxyRejectsOversizedFrame(t *testing.T) {
	upstream := newASRUpstreamServer(t, func(conn *websocket.Conn, _ *http.Request) {
		requireASRSessionStart(t, conn)
		writeASRUpstreamEvent(t, conn, map[string]any{"type": "session.created"})
		_, _, _ = conn.ReadMessage()
	})
	defer upstream.Close()
	proxy := newASRProxyTestServer(t, upstream.URL, "secret-api-key")
	defer proxy.Close()
	client := dialASRProxy(t, proxy.URL)
	defer client.Close()

	requireASRClientEvent(t, client, "ready", "")
	oversized := make([]byte, maxASRClientMessageBytes+2)
	if err := client.WriteMessage(websocket.BinaryMessage, oversized); err != nil {
		t.Fatalf("write oversized audio: %v", err)
	}
	_, _, err := client.ReadMessage()
	if !websocket.IsCloseError(err, websocket.CloseMessageTooBig) {
		t.Fatalf("read oversized close error = %v, want 1009", err)
	}
}

func TestASRRealtimeProxyRejectsRepeatedCommit(t *testing.T) {
	upstream := newASRUpstreamServer(t, func(conn *websocket.Conn, _ *http.Request) {
		requireASRSessionStart(t, conn)
		writeASRUpstreamEvent(t, conn, map[string]any{"type": "session.created"})
		_, _, _ = conn.ReadMessage()
		_, _, _ = conn.ReadMessage()
		_, _, _ = conn.ReadMessage()
	})
	defer upstream.Close()
	proxy := newASRProxyTestServer(t, upstream.URL, "secret-api-key")
	defer proxy.Close()
	client := dialASRProxy(t, proxy.URL)
	defer client.Close()

	requireASRClientEvent(t, client, "ready", "")
	_ = client.WriteMessage(websocket.BinaryMessage, []byte{1, 0})
	_ = client.WriteJSON(map[string]string{"type": "commit"})
	_ = client.WriteJSON(map[string]string{"type": "commit"})
	event := requireASRClientEvent(t, client, "error", "")
	if !strings.Contains(event.Message, "只能提交一次") {
		t.Fatalf("error message = %q", event.Message)
	}
}

func TestASRRealtimeProxyForwardsTerminalError(t *testing.T) {
	upstream := newASRUpstreamServer(t, func(conn *websocket.Conn, _ *http.Request) {
		requireASRSessionStart(t, conn)
		writeASRUpstreamEvent(t, conn, map[string]any{"type": "session.created"})
		writeASRUpstreamEvent(t, conn, map[string]any{
			"type": "error", "code": "bad_audio", "message": "音频格式错误",
		})
	})
	defer upstream.Close()
	proxy := newASRProxyTestServer(t, upstream.URL, "secret-api-key")
	defer proxy.Close()
	client := dialASRProxy(t, proxy.URL)
	defer client.Close()

	requireASRClientEvent(t, client, "ready", "")
	event := requireASRClientEvent(t, client, "error", "")
	if event.Message != "音频格式错误" {
		t.Fatalf("error message = %q", event.Message)
	}
}

func newASRUpstreamServer(t *testing.T, handler func(*websocket.Conn, *http.Request)) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		conn, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			t.Errorf("upgrade upstream: %v", err)
			return
		}
		defer conn.Close()
		handler(conn, request)
	}))
}

func newASRProxyTestServer(t *testing.T, upstreamHTTPURL, apiKey string) *httptest.Server {
	t.Helper()
	e := echo.New()
	server := &Server{
		cfg:            config.Config{ASRModel: config.ASRModelConfig{APIKey: apiKey}},
		asrRealtimeURL: "ws" + strings.TrimPrefix(upstreamHTTPURL, "http"),
	}
	e.GET("/api/client/asr/realtime", server.clientASRWebSocket, func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentUserContextKey, store.User{ID: "user-1"})
			return next(c)
		}
	})
	return httptest.NewServer(e)
}

func dialASRProxy(t *testing.T, proxyHTTPURL string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(proxyHTTPURL, "http") + "/api/client/asr/realtime"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial ASR proxy: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	return conn
}

func requireASRSessionStart(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read session start: %v", err)
	}
	if messageType != websocket.TextMessage || !bytes.Equal(payload, asrSessionStartMessage) {
		t.Fatalf("session start = %d/%s", messageType, payload)
	}
	var value map[string]any
	if json.Unmarshal(payload, &value) != nil || len(value) != 2 || value["type"] != "session.start" || value["task"] != "speech-to-text" {
		t.Fatalf("session start payload = %#v", value)
	}
}

func writeASRUpstreamEvent(t *testing.T, conn *websocket.Conn, event map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(event); err != nil {
		t.Fatalf("write upstream event: %v", err)
	}
}

func requireASRClientEvent(t *testing.T, conn *websocket.Conn, eventType, text string) asrClientEvent {
	t.Helper()
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read %s event: %v", eventType, err)
	}
	var event asrClientEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("decode %s event: %v", eventType, err)
	}
	if event.Type != eventType || (text != "" && event.Text != text) {
		t.Fatalf("event = %#v, want type=%s text=%q", event, eventType, text)
	}
	return event
}
