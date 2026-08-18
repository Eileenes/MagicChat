package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"

	conversationapp "app/internal/application/conversation"
	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
)

const methodConversationStatus = "conversation.status"

type conversationStatusRequest struct {
	ConversationID string `json:"conversation_id"`
	Status         string `json:"status"`
}

type conversationStatusSender struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type conversationStatusEvent struct {
	ConversationID string                   `json:"conversation_id"`
	Status         string                   `json:"status"`
	Sender         conversationStatusSender `json:"sender"`
}

func decodeConversationStatus(payload json.RawMessage) (conversationStatusRequest, error) {
	var request conversationStatusRequest
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return request, errors.New("multiple or invalid JSON values")
	}
	request.ConversationID = strings.TrimSpace(request.ConversationID)
	request.Status = strings.TrimSpace(request.Status)
	if _, err := uuid.Parse(request.ConversationID); err != nil {
		return request, errors.New("invalid conversation id")
	}
	length := utf8.RuneCountInString(request.Status)
	if length < 1 || length > 32 {
		return request, errors.New("invalid conversation status")
	}
	return request, nil
}

func (s *Server) handleConversationStatus(senderID, senderType string, envelope realtime.Envelope) realtime.Envelope {
	request, err := decodeConversationStatus(envelope.Payload)
	if err != nil {
		return realtime.NewErrorResponse(envelope.ID, "invalid_request", "请求格式错误")
	}
	target, err := s.conversations.ResolveStatusTarget(context.Background(), request.ConversationID, senderID, senderType)
	if err != nil {
		switch {
		case errors.Is(err, conversationapp.ErrStatusConversationNotFound):
			return realtime.NewErrorResponse(envelope.ID, "not_found", "会话不存在")
		case errors.Is(err, conversationapp.ErrStatusAccessDenied):
			return realtime.NewErrorResponse(envelope.ID, "forbidden", "无权访问该会话")
		case errors.Is(err, conversationapp.ErrStatusInvalidConversation):
			return realtime.NewErrorResponse(envelope.ID, "invalid_conversation", "该会话不支持状态转发")
		default:
			return realtime.NewErrorResponse(envelope.ID, "internal_error", "服务暂时不可用")
		}
	}
	event := realtime.NewEvent(realtime.EventConversationStatus, conversationStatusEvent{ConversationID: request.ConversationID, Status: request.Status, Sender: conversationStatusSender{ID: senderID, Type: senderType}})
	if target.Type == store.ConversationMemberTypeUser {
		s.realtime.SendToUser(target.ID, event)
	} else {
		s.appConnections.SendToApp(target.ID, event)
	}
	return realtime.NewResponse(envelope.ID, map[string]any{})
}
