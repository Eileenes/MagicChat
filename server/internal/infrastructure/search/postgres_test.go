package search

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	searchapp "app/internal/application/search"
	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestPostgresMessageBackendFiltersMessagesByAccessAndOptionalFields(t *testing.T) {
	db := openSearchBackendTestDB(t)
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	senderID := uuid.NewString()
	otherSenderID := uuid.NewString()
	groupID := uuid.NewString()
	inaccessibleID := uuid.NewString()
	parentID := uuid.NewString()
	topicID := uuid.NewString()
	hiddenTopicID := uuid.NewString()
	conversations := []store.Conversation{
		searchTestConversation(groupID, store.ConversationKindGroup, now),
		searchTestConversation(inaccessibleID, store.ConversationKindGroup, now),
		searchTestConversation(parentID, store.ConversationKindGroup, now),
		searchTestConversation(topicID, store.ConversationKindTopic, now),
		searchTestConversation(hiddenTopicID, store.ConversationKindTopic, now),
	}
	if err := db.Create(&conversations).Error; err != nil {
		t.Fatalf("create conversations: %v", err)
	}
	members := []store.ConversationMember{
		{ConversationID: groupID, MemberType: store.ConversationMemberTypeUser, MemberID: accountID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 2},
		{ConversationID: parentID, MemberType: store.ConversationMemberTypeUser, MemberID: accountID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1},
	}
	if err := db.Create(&members).Error; err != nil {
		t.Fatalf("create members: %v", err)
	}
	archivedAt := now.Add(-time.Hour)
	topics := []store.ConversationTopic{
		{ConversationID: topicID, ParentConversationID: parentID, SourceMessageID: uuid.NewString(), SourceMessageSeq: 1, SourceMessageBody: json.RawMessage(`{"type":"text"}`), SourceMessageSummary: "topic", SourceSenderType: store.MessageSenderTypeUser, SourceSenderID: &senderID, SourceSenderName: "Sender", CreatedByUserID: accountID, ArchivedAt: &archivedAt, CreatedAt: now, UpdatedAt: now},
		{ConversationID: hiddenTopicID, ParentConversationID: parentID, SourceMessageID: uuid.NewString(), SourceMessageSeq: 1, SourceMessageBody: json.RawMessage(`{"type":"text"}`), SourceMessageSummary: "hidden", SourceSenderType: store.MessageSenderTypeUser, SourceSenderID: &senderID, SourceSenderName: "Sender", CreatedByUserID: accountID, CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&topics).Error; err != nil {
		t.Fatalf("create topics: %v", err)
	}
	participant := store.ConversationTopicParticipant{
		ConversationID: topicID, ParticipantType: store.ConversationMemberTypeUser, ParticipantID: accountID,
		JoinedReason: store.TopicParticipantReasonMessage, JoinedAt: now, HistoryVisibleFromSeq: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&participant).Error; err != nil {
		t.Fatalf("create participant: %v", err)
	}

	visibleGroupID := uuid.NewString()
	visibleTopicID := uuid.NewString()
	messages := []store.Message{
		searchTestMessage(uuid.NewString(), groupID, 1, senderID, "发布计划：历史不可见", now.Add(-8*time.Minute)),
		searchTestMessage(visibleGroupID, groupID, 2, senderID, "发布计划：群聊", now.Add(-2*time.Minute)),
		searchTestMessage(uuid.NewString(), inaccessibleID, 1, senderID, "发布计划：无权会话", now.Add(-time.Minute)),
		searchTestMessage(visibleTopicID, topicID, 1, otherSenderID, "发布计划：已关闭话题", now.Add(-3*time.Minute)),
		searchTestMessage(uuid.NewString(), hiddenTopicID, 1, senderID, "发布计划：未参与话题", now.Add(-4*time.Minute)),
		searchTestMessage(uuid.NewString(), groupID, 3, senderID, "发布计划：超过一年", now.AddDate(-1, 0, -1)),
	}
	revoked := searchTestMessage(uuid.NewString(), groupID, 4, senderID, "发布计划：已撤回", now.Add(-5*time.Minute))
	revoked.RevokedAt = &archivedAt
	deleted := searchTestMessage(uuid.NewString(), groupID, 5, senderID, "发布计划：已删除", now.Add(-6*time.Minute))
	deleted.DeletedAt = &archivedAt
	system := searchTestMessage(uuid.NewString(), groupID, 6, senderID, "发布计划：系统消息", now.Add(-7*time.Minute))
	system.SenderType = store.MessageSenderTypeSystem
	system.SenderID = nil
	messages = append(messages, revoked, deleted, system)
	if err := db.Create(&messages).Error; err != nil {
		t.Fatalf("create messages: %v", err)
	}

	backend := NewPostgresMessageBackend(db)
	page, err := backend.SearchCandidates(context.Background(), searchapp.CandidateQuery{
		AccountID: accountID, Keyword: "发布计划", From: now.AddDate(-1, 0, 0), To: now, Limit: 20,
	})
	if err != nil {
		t.Fatalf("SearchCandidates() error = %v", err)
	}
	if len(page.Candidates) != 2 || page.Candidates[0].ID != visibleGroupID || page.Candidates[1].ID != visibleTopicID {
		t.Fatalf("SearchCandidates() = %#v", page.Candidates)
	}

	senderPage, err := backend.SearchCandidates(context.Background(), searchapp.CandidateQuery{
		AccountID: accountID, Keyword: "发布计划", SenderID: otherSenderID,
		From: now.AddDate(-1, 0, 0), To: now, Limit: 20,
	})
	if err != nil {
		t.Fatalf("SearchCandidates(sender) error = %v", err)
	}
	if len(senderPage.Candidates) != 1 || senderPage.Candidates[0].ID != visibleTopicID {
		t.Fatalf("SearchCandidates(sender) = %#v", senderPage.Candidates)
	}

	conversationPage, err := backend.SearchCandidates(context.Background(), searchapp.CandidateQuery{
		AccountID: accountID, Keyword: "发布计划", ConversationID: groupID,
		From: now.AddDate(-1, 0, 0), To: now, Limit: 20,
	})
	if err != nil {
		t.Fatalf("SearchCandidates(conversation) error = %v", err)
	}
	if len(conversationPage.Candidates) != 1 || conversationPage.Candidates[0].ID != visibleGroupID {
		t.Fatalf("SearchCandidates(conversation) = %#v", conversationPage.Candidates)
	}
}

func TestPostgresMessageBackendTreatsLikeMetacharactersLiterally(t *testing.T) {
	db := openSearchBackendTestDB(t)
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	conversationID := uuid.NewString()
	senderID := uuid.NewString()
	conversation := searchTestConversation(conversationID, store.ConversationKindGroup, now)
	member := store.ConversationMember{ConversationID: conversationID, MemberType: store.ConversationMemberTypeUser, MemberID: accountID, Role: store.ConversationMemberRoleOwner, JoinedAt: now, HistoryVisibleFromSeq: 1}
	messages := []store.Message{
		searchTestMessage(uuid.NewString(), conversationID, 1, senderID, "进度 100%_完成", now),
		searchTestMessage(uuid.NewString(), conversationID, 2, senderID, "进度 100xA完成", now.Add(-time.Second)),
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatalf("create member: %v", err)
	}
	if err := db.Create(&messages).Error; err != nil {
		t.Fatalf("create messages: %v", err)
	}

	page, err := NewPostgresMessageBackend(db).SearchCandidates(context.Background(), searchapp.CandidateQuery{
		AccountID: accountID, Keyword: "%_", From: now.AddDate(-1, 0, 0), To: now, Limit: 20,
	})
	if err != nil {
		t.Fatalf("SearchCandidates() error = %v", err)
	}
	if len(page.Candidates) != 1 || page.Candidates[0].Seq != 1 {
		t.Fatalf("SearchCandidates() = %#v", page.Candidates)
	}
}

func openSearchBackendTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{DisableForeignKeyConstraintWhenMigrating: true},
	)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&store.Conversation{},
		&store.ConversationMember{},
		&store.ConversationTopic{},
		&store.ConversationTopicParticipant{},
		&store.Message{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func searchTestConversation(id string, kind string, now time.Time) store.Conversation {
	return store.Conversation{
		ID: id, Kind: kind, Name: kind, CreatedByUserID: uuid.NewString(),
		Status: store.ConversationStatusActive, PostingPolicy: store.ConversationPostingPolicyOpen,
		Visibility: store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now,
	}
}

func searchTestMessage(id string, conversationID string, seq int64, senderID string, summary string, createdAt time.Time) store.Message {
	return store.Message{
		ID: id, ConversationID: conversationID, Seq: seq,
		SenderType: store.MessageSenderTypeUser, SenderID: &senderID,
		Body: json.RawMessage(`{"type":"text"}`), Summary: summary,
		CreatedAt: createdAt, UpdatedAt: createdAt,
	}
}
