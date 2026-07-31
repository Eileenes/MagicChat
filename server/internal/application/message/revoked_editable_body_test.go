package message

import (
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"
)

func TestNewMessageForUserExposesEditableRevokedBodyOnlyForOwnTextAndMarkdown(t *testing.T) {
	revokedAt := time.Now().UTC()
	senderID := "sender-1"

	tests := []struct {
		body            json.RawMessage
		name            string
		revokedByUserID string
		senderType      string
		userID          string
		wantBody        bool
	}{
		{body: json.RawMessage(`{"type":"text","content":"继续编辑"}`), name: "own text", revokedByUserID: senderID, senderType: store.MessageSenderTypeUser, userID: senderID, wantBody: true},
		{body: json.RawMessage(`{"type":"markdown","content":"**继续编辑**"}`), name: "own markdown", revokedByUserID: senderID, senderType: store.MessageSenderTypeUser, userID: senderID, wantBody: true},
		{body: json.RawMessage(`{"type":"image","file_id":"file-1"}`), name: "own image", revokedByUserID: senderID, senderType: store.MessageSenderTypeUser, userID: senderID, wantBody: false},
		{body: json.RawMessage(`{"type":"text","content":"不可见"}`), name: "revoked by admin", revokedByUserID: "admin-1", senderType: store.MessageSenderTypeUser, userID: senderID, wantBody: false},
		{body: json.RawMessage(`{"type":"text","content":"不可见"}`), name: "other user text", revokedByUserID: senderID, senderType: store.MessageSenderTypeUser, userID: "user-2", wantBody: false},
		{body: json.RawMessage(`{"type":"text","content":"不可见"}`), name: "app text", revokedByUserID: senderID, senderType: store.MessageSenderTypeApp, userID: senderID, wantBody: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			revokedByUserID := test.revokedByUserID
			message, err := newMessageForUser(nil, store.Message{
				Body: test.body, RevokedAt: &revokedAt, RevokedByUserID: &revokedByUserID,
				SenderID: &senderID, SenderType: test.senderType,
			}, test.userID)
			if err != nil {
				t.Fatalf("newMessageForUser() error = %v", err)
			}
			if got := len(message.EditableBody) > 0; got != test.wantBody {
				t.Fatalf("editable body present = %t, want %t; body = %s", got, test.wantBody, message.EditableBody)
			}
			if test.wantBody && string(message.EditableBody) != string(test.body) {
				t.Fatalf("editable body = %s, want %s", message.EditableBody, test.body)
			}
			if message.Body != nil {
				t.Fatalf("body = %s, want omitted", message.Body)
			}
		})
	}
}
