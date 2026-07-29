package search

import (
	"context"
	"time"

	conversationapp "app/internal/application/conversation"
	messageapp "app/internal/application/message"
)

const (
	ResultLimit          = 10
	MinimumKeywordRunes  = 2
	MaximumKeywordRunes  = 200
	candidatePageSize    = 20
	maximumCandidatePage = 50
	defaultSearchTimeout = 3 * time.Second
)

type SearchMessagesCommand struct {
	AccountID      string
	ConversationID string
	From           *time.Time
	Keyword        string
	SenderID       string
	To             *time.Time
}

type SearchMessagesResult struct {
	Items []MessageResultItem
}

type MessageResultItem struct {
	Conversation conversationapp.SearchSummary
	Message      messageapp.Message
}

type CandidateQuery struct {
	AccountID      string
	Before         *CandidateCursor
	ConversationID string
	From           time.Time
	Keyword        string
	Limit          int
	SenderID       string
	To             time.Time
}

type CandidateCursor struct {
	CreatedAt time.Time
	ID        string
}

type Candidate struct {
	ConversationID string
	CreatedAt      time.Time
	ID             string
	Seq            int64
}

type CandidatePage struct {
	Candidates []Candidate
	Exhausted  bool
}

type MessageBackend interface {
	SearchCandidates(context.Context, CandidateQuery) (CandidatePage, error)
}

type MessageReader interface {
	LoadSearchMessages(context.Context, string, []string) (map[string]messageapp.Message, error)
}

type ConversationReader interface {
	LoadSearchSummaries(context.Context, string, []string) (map[string]conversationapp.SearchSummary, error)
}

type ClientService interface {
	SearchMessages(context.Context, SearchMessagesCommand) (SearchMessagesResult, error)
}
