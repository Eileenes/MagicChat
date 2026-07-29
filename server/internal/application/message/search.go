package message

import (
	"context"
	"errors"
	"strings"

	"app/internal/store"

	"gorm.io/gorm"
)

func (s *Service) LoadSearchMessages(ctx context.Context, accountID string, messageIDs []string) (map[string]Message, error) {
	result := make(map[string]Message, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}
	db := s.db.WithContext(ctx)
	storedByID, err := loadSearchStoredMessages(ctx, db, messageIDs)
	if err != nil {
		return nil, err
	}
	byConversation := make(map[string][]store.Message)
	for _, messageID := range messageIDs {
		message, ok := storedByID[messageID]
		if !ok {
			continue
		}
		byConversation[message.ConversationID] = append(byConversation[message.ConversationID], message)
	}

	loaded := make([]Message, 0, len(storedByID))
	for conversationID, messages := range byConversation {
		access, err := loadUserConversationAccess(db, conversationID, accountID, false)
		if err != nil {
			if errors.Is(err, errConversationAccessDenied) || errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return nil, err
		}
		if access.Context.IsTopic() && access.Participant == nil {
			continue
		}
		visibleFromSeq := access.visibleFromSeq()
		visible := messages[:0]
		for _, message := range messages {
			if message.Seq < visibleFromSeq || message.DeletedAt != nil || message.RevokedAt != nil {
				continue
			}
			if message.SenderType != store.MessageSenderTypeUser && message.SenderType != store.MessageSenderTypeApp {
				continue
			}
			visible = append(visible, message)
		}
		if len(visible) == 0 {
			continue
		}
		converted, err := newMessagesForUser(db, visible, visibleFromSeq)
		if err != nil {
			return nil, err
		}
		loaded = append(loaded, converted...)
	}

	if err := attachMessageTopics(db, loaded); err != nil {
		return nil, err
	}
	if err := attachMessageReactions(db, loaded, accountID); err != nil {
		return nil, err
	}
	if err := attachMessageChoices(db, loaded, accountID); err != nil {
		return nil, err
	}
	if err := attachSearchMessageSenders(db, loaded); err != nil {
		return nil, err
	}
	for _, message := range loaded {
		result[message.ID] = message
	}
	return result, nil
}

func attachSearchMessageSenders(db *gorm.DB, messages []Message) error {
	userIDs := make([]string, 0, len(messages))
	appIDs := make([]string, 0, len(messages))
	seenUsers := make(map[string]struct{}, len(messages))
	seenApps := make(map[string]struct{}, len(messages))
	for _, message := range messages {
		if message.Sender.ID == "" {
			continue
		}
		switch message.Sender.Type {
		case store.MessageSenderTypeUser:
			if _, exists := seenUsers[message.Sender.ID]; !exists {
				seenUsers[message.Sender.ID] = struct{}{}
				userIDs = append(userIDs, message.Sender.ID)
			}
		case store.MessageSenderTypeApp:
			if _, exists := seenApps[message.Sender.ID]; !exists {
				seenApps[message.Sender.ID] = struct{}{}
				appIDs = append(appIDs, message.Sender.ID)
			}
		}
	}

	usersByID := make(map[string]store.User, len(userIDs))
	if len(userIDs) > 0 {
		var users []store.User
		if err := db.Select("id", "name", "nickname").Find(&users, "id IN ?", userIDs).Error; err != nil {
			return err
		}
		for _, user := range users {
			usersByID[user.ID] = user
		}
	}
	appsByID := make(map[string]store.App, len(appIDs))
	if len(appIDs) > 0 {
		var apps []store.App
		if err := db.Unscoped().Select("id", "name").Find(&apps, "id IN ?", appIDs).Error; err != nil {
			return err
		}
		for _, app := range apps {
			appsByID[app.ID] = app
		}
	}

	for index := range messages {
		sender := &messages[index].Sender
		switch sender.Type {
		case store.MessageSenderTypeUser:
			if user, ok := usersByID[sender.ID]; ok {
				sender.Name = user.Name
				sender.Nickname = user.Nickname
			}
		case store.MessageSenderTypeApp:
			if app, ok := appsByID[sender.ID]; ok {
				sender.Name = app.Name
			}
			if strings.TrimSpace(sender.Name) == "" {
				sender.Name = "应用"
			}
		}
	}
	return nil
}

func loadSearchStoredMessages(ctx context.Context, db *gorm.DB, messageIDs []string) (map[string]store.Message, error) {
	if !store.MessagePartitioningEnabled(db) {
		var messages []store.Message
		if err := db.Where(
			"id IN ? AND deleted_at IS NULL AND revoked_at IS NULL AND sender_type IN ?",
			messageIDs, []string{store.MessageSenderTypeUser, store.MessageSenderTypeApp},
		).Find(&messages).Error; err != nil {
			return nil, err
		}
		result := make(map[string]store.Message, len(messages))
		for _, message := range messages {
			result[message.ID] = message
		}
		return result, nil
	}

	var registries []store.MessageRegistry
	if err := db.Where(
		"id IN ? AND deleted_at IS NULL AND revoked_at IS NULL AND sender_type IN ?",
		messageIDs, []string{store.MessageSenderTypeUser, store.MessageSenderTypeApp},
	).Find(&registries).Error; err != nil {
		return nil, err
	}
	return store.LoadMessagesByRegistry(ctx, db, registries)
}
