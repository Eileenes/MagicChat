package conversation

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

func TestRecordFriendshipCreatedCreatesDirectSystemMessage(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, 8, 19, 15, 0, 0, 0, time.UTC)
	alice := insertConversationTestUser(t, db, "alice-friendship-message@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "bob-friendship-message@example.com", "Bob", now)
	notifications := &conversationNotificationRecorder{db: db}
	service := NewService(Dependencies{
		DB: db, Now: func() time.Time { return now }, Notifications: notifications,
	})

	var result RecordFriendshipCreatedResult
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = service.RecordFriendshipCreated(context.Background(), tx, RecordFriendshipCreatedCommand{
			ActorUserID: bob.ID, AddresseeUserID: bob.ID,
			CreatedAt: now, RequesterUserID: alice.ID,
		})
		return err
	}); err != nil {
		t.Fatalf("record friendship message: %v", err)
	}
	if result.Message.Summary != "你们已成为好友，现在可以开始聊天了" || result.Message.Seq != 1 {
		t.Fatalf("message = %#v", result.Message)
	}
	var body struct {
		Event string `json:"event"`
		Type  string `json:"type"`
	}
	if err := json.Unmarshal(result.Message.Body, &body); err != nil {
		t.Fatalf("decode system body: %v", err)
	}
	if body.Type != "system_event" || body.Event != "friendship_created" {
		t.Fatalf("system body = %#v", body)
	}
	var direct store.DirectConversation
	if err := db.First(&direct, "conversation_id = ?", result.Message.ConversationID).Error; err != nil {
		t.Fatalf("load direct conversation: %v", err)
	}
	lowID, highID := orderUserIDs(alice.ID, bob.ID)
	if direct.UserLowID != lowID || direct.UserHighID != highID {
		t.Fatalf("direct conversation = %#v", direct)
	}
	var aliceMember, bobMember store.ConversationMember
	if err := db.First(&aliceMember, "conversation_id = ? AND member_id = ?", direct.ConversationID, alice.ID).Error; err != nil {
		t.Fatalf("load alice member: %v", err)
	}
	if err := db.First(&bobMember, "conversation_id = ? AND member_id = ?", direct.ConversationID, bob.ID).Error; err != nil {
		t.Fatalf("load bob member: %v", err)
	}
	if aliceMember.LastReadSeq != 0 || bobMember.LastReadSeq != 1 {
		t.Fatalf("read seqs = alice %d, bob %d", aliceMember.LastReadSeq, bobMember.LastReadSeq)
	}

	service.PublishFriendshipCreated(context.Background(), result)
	if notifications.messages != 1 || !notifications.sawCommittedMessage {
		t.Fatalf("notifications = %#v", notifications)
	}
}
