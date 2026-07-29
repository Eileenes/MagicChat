package conversation

import (
	"context"

	"app/internal/store"
)

func (s *Service) LoadSearchSummaries(ctx context.Context, accountID string, conversationIDs []string) (map[string]SearchSummary, error) {
	result := make(map[string]SearchSummary, len(conversationIDs))
	if len(conversationIDs) == 0 {
		return result, nil
	}
	db := s.db.WithContext(ctx)
	var conversations []store.Conversation
	if err := db.Where("id IN ? AND status = ?", conversationIDs, store.ConversationStatusActive).
		Find(&conversations).Error; err != nil {
		return nil, err
	}
	if len(conversations) == 0 {
		return result, nil
	}

	loadedIDs := make([]string, 0, len(conversations))
	for _, conversation := range conversations {
		loadedIDs = append(loadedIDs, conversation.ID)
	}
	members, users, apps, err := s.loadListMembers(db, loadedIDs)
	if err != nil {
		return nil, err
	}
	topics, err := loadTopicPresentations(db, conversations, accountID)
	if err != nil {
		return nil, err
	}
	for _, conversation := range conversations {
		item := newItem(conversation, accountID, members[conversation.ID], users, apps)
		if conversation.Kind == store.ConversationKindTopic {
			presentation, ok := topics[conversation.ID]
			if !ok || presentation.participant == nil {
				continue
			}
			item = newTopicItem(conversation, accountID, members[conversation.ID], users, apps, presentation)
		}
		result[conversation.ID] = SearchSummary{
			Avatar: item.Avatar, ID: item.ID, Name: item.Name, Type: item.Type,
		}
	}
	return result, nil
}
