package search

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	conversationapp "app/internal/application/conversation"

	"github.com/google/uuid"
)

type Dependencies struct {
	Backend       MessageBackend
	Conversations ConversationReader
	Messages      MessageReader
	Now           func() time.Time
	Timeout       time.Duration
}

type Service struct {
	backend       MessageBackend
	conversations ConversationReader
	messages      MessageReader
	now           func() time.Time
	timeout       time.Duration
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	timeout := deps.Timeout
	if timeout <= 0 {
		timeout = defaultSearchTimeout
	}
	return &Service{
		backend: deps.Backend, conversations: deps.Conversations, messages: deps.Messages,
		now: now, timeout: timeout,
	}
}

func (s *Service) SearchMessages(ctx context.Context, cmd SearchMessagesCommand) (SearchMessagesResult, error) {
	query, err := s.normalizeMessageQuery(cmd)
	if err != nil {
		return SearchMessagesResult{}, err
	}
	if s.backend == nil || s.messages == nil || s.conversations == nil {
		return SearchMessagesResult{}, internalError(fmt.Errorf("message search dependencies are incomplete"))
	}
	searchCtx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	result := SearchMessagesResult{Items: []MessageResultItem{}}
	seenMessages := make(map[string]struct{}, ResultLimit)
	conversationCache := make(map[string]conversationapp.SearchSummary)
	var cursor *CandidateCursor
	for range maximumCandidatePage {
		query.Before = cursor
		page, err := s.backend.SearchCandidates(searchCtx, query)
		if err != nil {
			return SearchMessagesResult{}, mapOperationError(searchCtx, err)
		}
		if len(page.Candidates) == 0 {
			break
		}

		messageIDs := make([]string, 0, len(page.Candidates))
		for _, candidate := range page.Candidates {
			if _, ok := seenMessages[candidate.ID]; ok {
				continue
			}
			messageIDs = append(messageIDs, candidate.ID)
		}
		messages, err := s.messages.LoadSearchMessages(searchCtx, query.AccountID, messageIDs)
		if err != nil {
			return SearchMessagesResult{}, mapOperationError(searchCtx, err)
		}

		missingConversationIDs := make([]string, 0, len(messages))
		missingConversationSet := make(map[string]struct{}, len(messages))
		for _, message := range messages {
			if _, ok := conversationCache[message.ConversationID]; ok {
				continue
			}
			if _, ok := missingConversationSet[message.ConversationID]; ok {
				continue
			}
			missingConversationSet[message.ConversationID] = struct{}{}
			missingConversationIDs = append(missingConversationIDs, message.ConversationID)
		}
		if len(missingConversationIDs) > 0 {
			conversations, err := s.conversations.LoadSearchSummaries(searchCtx, query.AccountID, missingConversationIDs)
			if err != nil {
				return SearchMessagesResult{}, mapOperationError(searchCtx, err)
			}
			for id, conversation := range conversations {
				conversationCache[id] = conversation
			}
		}

		for _, candidate := range page.Candidates {
			if _, ok := seenMessages[candidate.ID]; ok {
				continue
			}
			seenMessages[candidate.ID] = struct{}{}
			message, ok := messages[candidate.ID]
			if !ok {
				continue
			}
			conversation, ok := conversationCache[message.ConversationID]
			if !ok {
				continue
			}
			result.Items = append(result.Items, MessageResultItem{Conversation: conversation, Message: message})
			if len(result.Items) == ResultLimit {
				return result, nil
			}
		}

		last := page.Candidates[len(page.Candidates)-1]
		next := &CandidateCursor{CreatedAt: last.CreatedAt, ID: last.ID}
		if cursor != nil && cursor.CreatedAt.Equal(next.CreatedAt) && cursor.ID == next.ID {
			return SearchMessagesResult{}, internalError(fmt.Errorf("message search cursor did not advance"))
		}
		cursor = next
		if page.Exhausted {
			break
		}
	}
	return result, nil
}

func mapOperationError(ctx context.Context, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return timeoutError(err)
	}
	return internalError(err)
}

func (s *Service) normalizeMessageQuery(cmd SearchMessagesCommand) (CandidateQuery, error) {
	accountID, err := normalizeRequiredUUID(cmd.AccountID, "account_id")
	if err != nil {
		return CandidateQuery{}, err
	}
	keyword := strings.TrimSpace(cmd.Keyword)
	keywordRunes := utf8.RuneCountInString(keyword)
	if keywordRunes < MinimumKeywordRunes {
		return CandidateQuery{}, invalidRequest("keyword 至少需要 2 个字符", nil)
	}
	if keywordRunes > MaximumKeywordRunes {
		return CandidateQuery{}, invalidRequest("keyword 不能超过 200 个字符", nil)
	}
	conversationID, err := normalizeOptionalUUID(cmd.ConversationID, "conversation_id")
	if err != nil {
		return CandidateQuery{}, err
	}
	senderID, err := normalizeOptionalUUID(cmd.SenderID, "sender_id")
	if err != nil {
		return CandidateQuery{}, err
	}

	now := s.now().UTC()
	cutoff := now.AddDate(-1, 0, 0)
	from, to := cutoff, now
	if cmd.From != nil {
		from = cmd.From.UTC()
		if from.Before(cutoff) || from.After(now) {
			return CandidateQuery{}, invalidRequest("from 必须在最近一年内", nil)
		}
	}
	if cmd.To != nil {
		to = cmd.To.UTC()
		if to.Before(cutoff) || to.After(now) {
			return CandidateQuery{}, invalidRequest("to 必须在最近一年内", nil)
		}
	}
	if from.After(to) {
		return CandidateQuery{}, invalidRequest("from 不能晚于 to", nil)
	}

	return CandidateQuery{
		AccountID: accountID, ConversationID: conversationID, From: from,
		Keyword: keyword, Limit: candidatePageSize, SenderID: senderID, To: to,
	}, nil
}

func normalizeRequiredUUID(value string, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", invalidRequest(field+" 不能为空", nil)
	}
	return normalizeUUID(value, field)
}

func normalizeOptionalUUID(value string, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	return normalizeUUID(value, field)
}

func normalizeUUID(value string, field string) (string, error) {
	parsed, err := uuid.Parse(value)
	if err != nil {
		return "", invalidRequest(field+" 格式错误", err)
	}
	return parsed.String(), nil
}

var _ ClientService = (*Service)(nil)
