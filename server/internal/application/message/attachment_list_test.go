package message

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
)

func TestServiceListAttachmentsFiltersByVisibilityAndPaginates(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	now := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	senderID := fixture.user.ID
	revokedAt := now.Add(time.Minute)
	deletedAt := now.Add(time.Minute)
	messages := []store.Message{
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 1, now, `{"type":"text","content":"hello"}`),
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 2, now.Add(time.Minute), `{"type":"file","file_id":"hidden-file","name":"隐藏.pdf","size_bytes":10}`),
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 3, now.Add(2*time.Minute), `{"type":"file","file_id":"older-file","name":"旧文档.pdf","size_bytes":20}`),
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 4, now.Add(3*time.Minute), `{"type":"file","file_id":"revoked-file","name":"已撤回.pdf","size_bytes":30}`),
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 5, now.Add(4*time.Minute), `{"type":"file","file_id":"deleted-file","name":"已删除.pdf","size_bytes":40}`),
		newAttachmentListTestMessage(fixture.conversation.ID, &senderID, 6, now.Add(5*time.Minute), `{"type":"file","file_id":"newer-file","name":"新文档.pdf","size_bytes":50}`),
	}
	messages[3].RevokedAt = &revokedAt
	messages[4].DeletedAt = &deletedAt
	if err := db.Create(&messages).Error; err != nil {
		t.Fatalf("create messages: %v", err)
	}
	if err := db.Model(&store.ConversationMember{}).Where(
		"conversation_id = ? AND member_type = ? AND member_id = ?",
		fixture.conversation.ID, store.ConversationMemberTypeUser, fixture.user.ID,
	).Update("history_visible_from_seq", 3).Error; err != nil {
		t.Fatalf("update history visibility: %v", err)
	}
	service := NewService(Dependencies{DB: db})

	first, err := service.ListAttachments(context.Background(), ListAttachmentsCommand{
		AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, Limit: 1,
	})
	if err != nil {
		t.Fatalf("list first attachment page: %v", err)
	}
	if len(first.Attachments) != 1 || first.Attachments[0].FileID != "newer-file" || first.NextCursor != "6" {
		t.Fatalf("first page = %#v", first)
	}
	second, err := service.ListAttachments(context.Background(), ListAttachmentsCommand{
		AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID,
		Cursor: first.NextCursor, Limit: 1,
	})
	if err != nil {
		t.Fatalf("list second attachment page: %v", err)
	}
	if len(second.Attachments) != 1 || second.Attachments[0].FileID != "older-file" || second.NextCursor != "" {
		t.Fatalf("second page = %#v", second)
	}
}

func TestServiceListAttachmentsRejectsInvalidCursor(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	service := NewService(Dependencies{DB: db})

	_, err := service.ListAttachments(context.Background(), ListAttachmentsCommand{
		AccountID: fixture.user.ID, ConversationID: fixture.conversation.ID, Cursor: "invalid",
	})
	if ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("error = %v, want invalid_request", err)
	}
}

func newAttachmentListTestMessage(conversationID string, senderID *string, seq int64, createdAt time.Time, body string) store.Message {
	return store.Message{
		ID: uuid.NewString(), ConversationID: conversationID, Seq: seq,
		SenderType: store.MessageSenderTypeUser, SenderID: senderID,
		Body: json.RawMessage(body), Summary: "test", CreatedAt: createdAt, UpdatedAt: createdAt,
	}
}
