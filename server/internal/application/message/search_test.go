package message

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
)

func TestLoadSearchMessagesRevalidatesVisibilityAndMessageState(t *testing.T) {
	db := openMessageTestDB(t)
	fixture := insertMessageTestFixture(t, db)
	now := time.Date(2026, time.July, 15, 14, 0, 0, 0, time.UTC)
	if err := db.Model(&store.User{}).Where("id = ?", fixture.user.ID).
		Update("nickname", "测试用户").Error; err != nil {
		t.Fatalf("update sender nickname: %v", err)
	}
	if err := db.Model(&store.ConversationMember{}).Where(
		"conversation_id = ? AND member_type = ? AND member_id = ?",
		fixture.conversation.ID, store.ConversationMemberTypeUser, fixture.user.ID,
	).Update("history_visible_from_seq", 2).Error; err != nil {
		t.Fatalf("update history visibility: %v", err)
	}
	visibleID := uuid.NewString()
	hiddenID := uuid.NewString()
	revokedID := uuid.NewString()
	messages := []store.Message{
		{ID: hiddenID, ConversationID: fixture.conversation.ID, Seq: 1, SenderType: store.MessageSenderTypeUser, SenderID: &fixture.user.ID, Body: json.RawMessage(`{"type":"text","content":"hidden"}`), Summary: "hidden", CreatedAt: now, UpdatedAt: now},
		{ID: visibleID, ConversationID: fixture.conversation.ID, Seq: 2, SenderType: store.MessageSenderTypeUser, SenderID: &fixture.user.ID, Body: json.RawMessage(`{"type":"text","content":"visible"}`), Summary: "visible", CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute)},
		{ID: revokedID, ConversationID: fixture.conversation.ID, Seq: 3, SenderType: store.MessageSenderTypeUser, SenderID: &fixture.user.ID, Body: json.RawMessage(`{"type":"text","content":"revoked"}`), Summary: "revoked", RevokedAt: &now, CreatedAt: now.Add(2 * time.Minute), UpdatedAt: now.Add(2 * time.Minute)},
	}
	if err := db.Create(&messages).Error; err != nil {
		t.Fatalf("create messages: %v", err)
	}

	service := NewService(Dependencies{DB: db})
	result, err := service.LoadSearchMessages(
		context.Background(), fixture.user.ID, []string{hiddenID, revokedID, visibleID},
	)
	if err != nil {
		t.Fatalf("LoadSearchMessages() error = %v", err)
	}
	if len(result) != 1 || result[visibleID].Summary != "visible" || len(result[visibleID].Body) == 0 {
		t.Fatalf("LoadSearchMessages() = %#v", result)
	}
	if result[visibleID].Sender.Name != fixture.user.Name || result[visibleID].Sender.Nickname != "测试用户" {
		t.Fatalf("sender = %#v", result[visibleID].Sender)
	}
}
