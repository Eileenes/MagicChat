package httpserver

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"
)

func TestMobilePushEnqueueContextSurvivesRequestCancellation(t *testing.T) {
	type contextKey string
	parent, cancelParent := context.WithCancel(context.WithValue(t.Context(), contextKey("request"), "value"))
	cancelParent()
	ctx, cancel := mobilePushEnqueueContext(parent)
	defer cancel()
	if err := ctx.Err(); err != nil {
		t.Fatalf("enqueue context error = %v", err)
	}
	if got := ctx.Value(contextKey("request")); got != "value" {
		t.Fatalf("enqueue context value = %v", got)
	}
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) <= 0 || time.Until(deadline) > 5*time.Second {
		t.Fatalf("enqueue deadline = %v, %v", deadline, ok)
	}
}

func TestMobilePushActorUserID(t *testing.T) {
	tests := []struct {
		name                       string
		senderType, senderID       string
		delegatedType, delegatedID string
		body                       json.RawMessage
		want                       string
	}{
		{name: "user sender", senderType: store.MessageSenderTypeUser, senderID: "user-1", want: "user-1"},
		{name: "delegated app", senderType: store.MessageSenderTypeApp, delegatedType: store.MessageSenderTypeUser, delegatedID: "user-2", want: "user-2"},
		{name: "system actor", senderType: store.MessageSenderTypeSystem, body: json.RawMessage(`{"type":"system_event","event":"group_name_updated","actor":{"id":"user-3"}}`), want: "user-3"},
		{name: "inviter", senderType: store.MessageSenderTypeSystem, body: json.RawMessage(`{"type":"system_event","event":"group_members_invited","inviter":{"id":"user-4"}}`), want: "user-4"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := mobilePushActorUserID(test.senderType, test.senderID, test.delegatedType, test.delegatedID, test.body); got != test.want {
				t.Fatalf("actor = %q, want %q", got, test.want)
			}
		})
	}
}
