package conversation

import (
	"context"
	"testing"
	"time"
)

func TestLoadSearchSummariesUsesUserSpecificDirectConversationPresentation(t *testing.T) {
	db := openConversationTestDB(t)
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	owner := insertConversationTestUser(t, db, "search-owner@example.com", "Owner", now)
	member := insertConversationTestUser(t, db, "search-member@example.com", "Member", now)
	member.Nickname = "Teammate"
	member.Avatar = "/teammate.webp"
	if err := db.Model(&member).Updates(map[string]any{"nickname": member.Nickname, "avatar": member.Avatar}).Error; err != nil {
		t.Fatalf("update member profile: %v", err)
	}
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})
	created, err := service.CreateDirect(context.Background(), CreateDirectCommand{
		Actor: actorFromTestUser(owner), UserID: member.ID,
	})
	if err != nil {
		t.Fatalf("create direct conversation: %v", err)
	}

	summaries, err := service.LoadSearchSummaries(
		context.Background(), owner.ID, []string{created.Conversation.ID},
	)
	if err != nil {
		t.Fatalf("LoadSearchSummaries() error = %v", err)
	}
	summary, ok := summaries[created.Conversation.ID]
	if !ok || summary.Name != "Teammate" || summary.Avatar != "/teammate.webp" || summary.Type != "direct" {
		t.Fatalf("summary = %#v, found = %v", summary, ok)
	}
}
