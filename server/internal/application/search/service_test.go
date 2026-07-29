package search

import (
	"context"
	"errors"
	"testing"
	"time"

	conversationapp "app/internal/application/conversation"
	messageapp "app/internal/application/message"

	"github.com/google/uuid"
)

func TestSearchMessagesUsesRollingYearAndAssemblesAuthorizedResults(t *testing.T) {
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	conversationID := uuid.NewString()
	senderID := uuid.NewString()
	firstID := uuid.NewString()
	hiddenID := uuid.NewString()
	thirdID := uuid.NewString()
	backend := &searchBackendStub{pages: []CandidatePage{{
		Candidates: []Candidate{
			{ID: firstID, ConversationID: conversationID, CreatedAt: now.Add(-time.Minute), Seq: 3},
			{ID: hiddenID, ConversationID: conversationID, CreatedAt: now.Add(-2 * time.Minute), Seq: 2},
			{ID: thirdID, ConversationID: conversationID, CreatedAt: now.Add(-3 * time.Minute), Seq: 1},
		},
		Exhausted: true,
	}}}
	messages := &searchMessageReaderStub{values: map[string]messageapp.Message{
		firstID: {ID: firstID, ConversationID: conversationID, Summary: "发布计划", CreatedAt: now.Add(-time.Minute)},
		thirdID: {ID: thirdID, ConversationID: conversationID, Summary: "旧发布计划", CreatedAt: now.Add(-3 * time.Minute)},
	}}
	conversations := &searchConversationReaderStub{values: map[string]conversationapp.SearchSummary{
		conversationID: {ID: conversationID, Name: "研发群", Type: "group", Avatar: "/group.webp"},
	}}
	service := NewService(Dependencies{
		Backend: backend, Messages: messages, Conversations: conversations,
		Now: func() time.Time { return now },
	})

	result, err := service.SearchMessages(context.Background(), SearchMessagesCommand{
		AccountID: accountID, ConversationID: " " + conversationID + " ",
		Keyword: " 发布计划 ", SenderID: senderID,
	})
	if err != nil {
		t.Fatalf("SearchMessages() error = %v", err)
	}
	if len(result.Items) != 2 || result.Items[0].Message.ID != firstID || result.Items[1].Message.ID != thirdID {
		t.Fatalf("SearchMessages() items = %#v", result.Items)
	}
	if result.Items[0].Conversation.Name != "研发群" {
		t.Fatalf("conversation = %#v", result.Items[0].Conversation)
	}
	if len(backend.queries) != 1 {
		t.Fatalf("backend query count = %d, want 1", len(backend.queries))
	}
	query := backend.queries[0]
	if query.AccountID != accountID || query.Keyword != "发布计划" || query.ConversationID != conversationID || query.SenderID != senderID {
		t.Fatalf("backend query = %#v", query)
	}
	if !query.From.Equal(now.AddDate(-1, 0, 0)) || !query.To.Equal(now) || query.Limit != candidatePageSize {
		t.Fatalf("backend range = %s..%s limit=%d", query.From, query.To, query.Limit)
	}
}

func TestSearchMessagesContinuesAfterCandidatesDisappearDuringValidation(t *testing.T) {
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	conversationID := uuid.NewString()
	disappearedID := uuid.NewString()
	visibleID := uuid.NewString()
	backend := &searchBackendStub{pages: []CandidatePage{
		{Candidates: []Candidate{{ID: disappearedID, ConversationID: conversationID, CreatedAt: now, Seq: 2}}},
		{Candidates: []Candidate{{ID: visibleID, ConversationID: conversationID, CreatedAt: now.Add(-time.Minute), Seq: 1}}, Exhausted: true},
	}}
	service := NewService(Dependencies{
		Backend: backend,
		Messages: &searchMessageReaderStub{values: map[string]messageapp.Message{
			visibleID: {ID: visibleID, ConversationID: conversationID},
		}},
		Conversations: &searchConversationReaderStub{values: map[string]conversationapp.SearchSummary{
			conversationID: {ID: conversationID, Name: "群聊", Type: "group"},
		}},
		Now: func() time.Time { return now },
	})

	result, err := service.SearchMessages(context.Background(), SearchMessagesCommand{
		AccountID: accountID, Keyword: "消息",
	})
	if err != nil {
		t.Fatalf("SearchMessages() error = %v", err)
	}
	if len(result.Items) != 1 || result.Items[0].Message.ID != visibleID {
		t.Fatalf("SearchMessages() items = %#v", result.Items)
	}
	if len(backend.queries) != 2 || backend.queries[1].Before == nil || backend.queries[1].Before.ID != disappearedID {
		t.Fatalf("backend queries = %#v", backend.queries)
	}
}

func TestSearchMessagesReturnsAtMostTenItems(t *testing.T) {
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	conversationID := uuid.NewString()
	candidates := make([]Candidate, 12)
	messages := make(map[string]messageapp.Message, len(candidates))
	for index := range candidates {
		id := uuid.NewString()
		candidates[index] = Candidate{ID: id, ConversationID: conversationID, CreatedAt: now.Add(-time.Duration(index) * time.Minute)}
		messages[id] = messageapp.Message{ID: id, ConversationID: conversationID}
	}
	service := NewService(Dependencies{
		Backend:  &searchBackendStub{pages: []CandidatePage{{Candidates: candidates}}},
		Messages: &searchMessageReaderStub{values: messages},
		Conversations: &searchConversationReaderStub{values: map[string]conversationapp.SearchSummary{
			conversationID: {ID: conversationID},
		}},
		Now: func() time.Time { return now },
	})

	result, err := service.SearchMessages(context.Background(), SearchMessagesCommand{
		AccountID: accountID, Keyword: "消息",
	})
	if err != nil {
		t.Fatalf("SearchMessages() error = %v", err)
	}
	if len(result.Items) != ResultLimit {
		t.Fatalf("item count = %d, want %d", len(result.Items), ResultLimit)
	}
}

func TestSearchMessagesStopsWhenOperationTimesOut(t *testing.T) {
	service := NewService(Dependencies{
		Backend:       searchBlockingBackend{},
		Messages:      &searchMessageReaderStub{},
		Conversations: &searchConversationReaderStub{},
		Timeout:       5 * time.Millisecond,
	})

	_, err := service.SearchMessages(context.Background(), SearchMessagesCommand{
		AccountID: uuid.NewString(), Keyword: "消息",
	})
	if ErrorCodeOf(err) != CodeTimeout || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("SearchMessages() error = %v, code = %s", err, ErrorCodeOf(err))
	}
}

func TestSearchMessagesRejectsInvalidInput(t *testing.T) {
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.UTC)
	accountID := uuid.NewString()
	tooOld := now.AddDate(-1, 0, -1)
	afterNow := now.Add(time.Second)
	cases := []struct {
		name string
		cmd  SearchMessagesCommand
	}{
		{name: "short keyword", cmd: SearchMessagesCommand{AccountID: accountID, Keyword: "a"}},
		{name: "invalid sender", cmd: SearchMessagesCommand{AccountID: accountID, Keyword: "消息", SenderID: "bad"}},
		{name: "invalid conversation", cmd: SearchMessagesCommand{AccountID: accountID, Keyword: "消息", ConversationID: "bad"}},
		{name: "from too old", cmd: SearchMessagesCommand{AccountID: accountID, Keyword: "消息", From: &tooOld}},
		{name: "to in future", cmd: SearchMessagesCommand{AccountID: accountID, Keyword: "消息", To: &afterNow}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			service := NewService(Dependencies{Now: func() time.Time { return now }})
			_, err := service.SearchMessages(context.Background(), testCase.cmd)
			if ErrorCodeOf(err) != CodeInvalidRequest {
				t.Fatalf("SearchMessages() error = %v, code = %s", err, ErrorCodeOf(err))
			}
		})
	}
}

type searchBackendStub struct {
	pages   []CandidatePage
	queries []CandidateQuery
}

type searchBlockingBackend struct{}

func (searchBlockingBackend) SearchCandidates(ctx context.Context, _ CandidateQuery) (CandidatePage, error) {
	<-ctx.Done()
	return CandidatePage{}, ctx.Err()
}

func (s *searchBackendStub) SearchCandidates(_ context.Context, query CandidateQuery) (CandidatePage, error) {
	s.queries = append(s.queries, query)
	if len(s.pages) == 0 {
		return CandidatePage{Exhausted: true}, nil
	}
	page := s.pages[0]
	s.pages = s.pages[1:]
	return page, nil
}

type searchMessageReaderStub struct {
	values map[string]messageapp.Message
}

func (s *searchMessageReaderStub) LoadSearchMessages(_ context.Context, _ string, ids []string) (map[string]messageapp.Message, error) {
	result := make(map[string]messageapp.Message)
	for _, id := range ids {
		if value, ok := s.values[id]; ok {
			result[id] = value
		}
	}
	return result, nil
}

type searchConversationReaderStub struct {
	values map[string]conversationapp.SearchSummary
}

func (s *searchConversationReaderStub) LoadSearchSummaries(_ context.Context, _ string, ids []string) (map[string]conversationapp.SearchSummary, error) {
	result := make(map[string]conversationapp.SearchSummary)
	for _, id := range ids {
		if value, ok := s.values[id]; ok {
			result[id] = value
		}
	}
	return result, nil
}
