package conversation

import (
	"context"
	"errors"
	"testing"
	"time"

	"app/internal/store"
	"github.com/google/uuid"
)

func TestResolveStatusTargetDirectAndAccess(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Now().UTC()
	alice := insertConversationTestUser(t, db, "status-alice@example.com", "Alice", now)
	bob := insertConversationTestUser(t, db, "status-bob@example.com", "Bob", now)
	conversation := store.Conversation{ID: uuid.NewString(), Kind: store.ConversationKindDirect, Name: "", CreatedByUserID: alice.ID, Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen, Visibility: store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatal(err)
	}
	members := []store.ConversationMember{{ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: alice.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now}, {ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser, MemberID: bob.ID, Role: store.ConversationMemberRoleMember, JoinedAt: now}}
	if err := db.Create(&members).Error; err != nil {
		t.Fatal(err)
	}
	service := NewService(Dependencies{DB: db})
	target, err := service.ResolveStatusTarget(context.Background(), conversation.ID, alice.ID, store.ConversationMemberTypeUser)
	if err != nil || target.ID != bob.ID || target.Type != store.ConversationMemberTypeUser {
		t.Fatalf("target = %#v, err = %v", target, err)
	}
	if _, err := service.ResolveStatusTarget(context.Background(), conversation.ID, uuid.NewString(), store.ConversationMemberTypeUser); !errors.Is(err, ErrStatusAccessDenied) {
		t.Fatalf("non-member err = %v", err)
	}
	if err := db.Model(&conversation).Update("kind", store.ConversationKindGroup).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.ResolveStatusTarget(context.Background(), conversation.ID, alice.ID, store.ConversationMemberTypeUser); !errors.Is(err, ErrStatusInvalidConversation) {
		t.Fatalf("group err = %v", err)
	}
}
