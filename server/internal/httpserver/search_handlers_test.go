package httpserver

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"app/internal/store"
)

func TestSearchMessagesReturnsOnlyAuthorizedMessagesWithConversation(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()
	now := time.Now().UTC().Add(-time.Minute)
	alice := insertTestUser(t, db, "search-alice@example.com", "Alice", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "search-bob@example.com", "Bob", store.UserStatusActive, now)
	if err := db.Model(&store.User{}).Where("id = ?", bob.ID).Update("nickname", "小鲍").Error; err != nil {
		t.Fatalf("update sender nickname: %v", err)
	}
	visibleConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: alice.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{alice.ID, bob.ID}, name: "发布讨论", now: now,
	})
	hiddenConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: bob.ID, kind: store.ConversationKindGroup,
		memberIDs: []string{bob.ID}, name: "其他讨论", now: now,
	})
	visible := insertTestMessage(t, db, visibleConversation.ID, bob.ID, 1, "发布计划已经确认", now)
	insertTestMessage(t, db, hiddenConversation.ID, bob.ID, 1, "发布计划无权查看", now.Add(time.Second))
	insertTestMessage(t, db, visibleConversation.ID, alice.ID, 2, "普通消息", now.Add(2*time.Second))
	cookie := loginAsUser(t, server, alice.Email)

	resp, body := getJSON(
		t, server, "/api/client/search/messages?keyword="+url.QueryEscape("发布计划"), cookie,
	)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %#v", resp.StatusCode, body)
	}
	data := requireSuccess(t, body)
	items, ok := data["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v", data["items"])
	}
	item := items[0].(map[string]any)
	message := item["message"].(map[string]any)
	conversation := item["conversation"].(map[string]any)
	if message["id"] != visible.ID || message["summary"] != visible.Summary || message["sender_name"] != "小鲍" {
		t.Fatalf("message = %#v", message)
	}
	if conversation["id"] != visibleConversation.ID || conversation["name"] != visibleConversation.Name {
		t.Fatalf("conversation = %#v", conversation)
	}
}
