package httpserver

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	mobilepushapp "app/internal/application/mobilepush"
	"app/internal/store"
)

func (s *Server) enqueueMobileMessagePush(
	ctx context.Context,
	userID string,
	conversationID string,
	messageID string,
	senderType string,
	senderID string,
	delegatedType string,
	delegatedID string,
	body json.RawMessage,
	muted bool,
) {
	if s.mobilePush == nil {
		return
	}
	enqueueCtx, cancel := mobilePushEnqueueContext(ctx)
	defer cancel()
	if err := s.mobilePush.EnqueueMessage(enqueueCtx, mobilepushapp.MessageDelivery{
		UserID: userID, ActorUserID: mobilePushActorUserID(senderType, senderID, delegatedType, delegatedID, body),
		ConversationID: conversationID, MessageID: messageID,
		SenderType: senderType, SenderID: senderID, Muted: muted,
	}); err != nil {
		slog.Error("enqueue mobile push", "message_id", messageID, "user_id", userID, "error", err)
	}
}

func mobilePushEnqueueContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
}

func mobilePushActorUserID(senderType, senderID, delegatedType, delegatedID string, body json.RawMessage) string {
	if senderType == store.MessageSenderTypeUser {
		return senderID
	}
	if delegatedType == store.MessageSenderTypeUser {
		return delegatedID
	}
	if senderType != store.MessageSenderTypeSystem || len(body) == 0 {
		return ""
	}
	var event struct {
		Type  string `json:"type"`
		Event string `json:"event"`
		Actor struct {
			ID string `json:"id"`
		} `json:"actor"`
		Inviter struct {
			ID string `json:"id"`
		} `json:"inviter"`
	}
	if json.Unmarshal(body, &event) != nil || event.Type != "system_event" {
		return ""
	}
	if event.Event == "group_members_invited" {
		return event.Inviter.ID
	}
	return event.Actor.ID
}
