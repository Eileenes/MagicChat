package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"app/internal/appconnection"
	"app/internal/realtime"
	"app/internal/store"

	"gorm.io/gorm"
)

const appEventReplayPageSize = 100

type appMessageCreatedPayload struct {
	Conversation appMessageConversationPayload `json:"conversation"`
	Message      appMessagePayload             `json:"message"`
	Sender       appMessageSenderPayload       `json:"sender"`
}

type appMessageConversationPayload struct {
	CreatedByAppID string `json:"created_by_app_id,omitempty"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
}

type appMessagePayload struct {
	Body             json.RawMessage          `json:"body"`
	CreatedAt        time.Time                `json:"created_at"`
	DelegatedBy      *appMessageSenderPayload `json:"delegated_by,omitempty"`
	ID               string                   `json:"id"`
	ReplyToMessageID string                   `json:"reply_to_message_id,omitempty"`
	Seq              int64                    `json:"seq"`
	Sender           *appMessageSenderPayload `json:"sender,omitempty"`
	Summary          string                   `json:"summary"`
}

type appMessageSenderPayload struct {
	Email    string `json:"email,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Type     string `json:"type"`
}

func (s *Server) replayAppEvents(ctx context.Context, appID string, conn *appconnection.Connection) error {
	var ack store.AppEventAck
	lastAckedCursor := int64(0)
	err := s.db.First(&ack, "app_id = ?", appID).Error
	if err == nil {
		lastAckedCursor = ack.LastAckedCursor
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	nextCursor := lastAckedCursor
	for {
		var events []store.AppEventOutbox
		if err := s.db.
			Where("app_id = ? AND id > ?", appID, nextCursor).
			Order("id ASC").
			Limit(appEventReplayPageSize).
			Find(&events).Error; err != nil {
			return err
		}
		for _, event := range events {
			if err := s.withAppEventPayload(ctx, event.Payload, func(payload json.RawMessage) error {
				if !conn.EnqueueReliable(realtime.NewCursorEvent(event.ID, event.Event, payload)) {
					return errors.New("app connection closed during event replay")
				}
				return nil
			}); err != nil {
				return err
			}
		}
		if len(events) < appEventReplayPageSize {
			return nil
		}
		nextCursor = events[len(events)-1].ID
	}
}

func (s *Server) withAppEventPayload(ctx context.Context, payload json.RawMessage, operation func(json.RawMessage) error) error {
	return s.settings.WithUserNicknameEditingPolicy(ctx, func(_ *gorm.DB, allowed bool) error {
		if allowed {
			return operation(payload)
		}
		masked, err := maskNicknameFields(payload)
		if err != nil {
			return err
		}
		return operation(masked)
	})
}

func maskNicknameFields(payload json.RawMessage) (json.RawMessage, error) {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return nil, err
	}
	maskNicknameValue(value)
	return json.Marshal(value)
}

func maskNicknameValue(value any) {
	switch typed := value.(type) {
	case map[string]any:
		if identityType, _ := typed["type"].(string); identityType == store.MessageSenderTypeUser {
			if name, ok := typed["name"].(string); ok {
				if _, hasNickname := typed["nickname"]; hasNickname {
					typed["nickname"] = name
				}
			}
		}
		for _, child := range typed {
			maskNicknameValue(child)
		}
	case []any:
		for _, child := range typed {
			maskNicknameValue(child)
		}
	}
}
