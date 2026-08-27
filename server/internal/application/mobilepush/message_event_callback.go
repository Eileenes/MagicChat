package mobilepush

import (
	"fmt"
	"reflect"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const messageEventCallbackName = "mobilepush:enqueue_message_event"

var storedMessageType = reflect.TypeOf(store.Message{})

func (s *Service) registerMessageEventCallback() error {
	callbacks := s.db.Callback().Create()
	if callbacks.Get(messageEventCallbackName) != nil {
		return nil
	}
	return callbacks.After("gorm:create").Register(messageEventCallbackName, func(tx *gorm.DB) {
		if tx.Error != nil || tx.Statement == nil || tx.Statement.Schema == nil ||
			tx.Statement.Schema.Table != "messages" {
			return
		}
		messages := storedMessagesFromDestination(tx.Statement.Dest)
		if len(messages) == 0 {
			tx.AddError(fmt.Errorf("mobile push event callback cannot read created messages"))
			return
		}
		now := s.now().UTC()
		events := make([]store.MobilePushEvent, 0, len(messages))
		for _, message := range messages {
			if message.ID == "" || message.ConversationID == "" || message.Seq < 1 {
				tx.AddError(fmt.Errorf("mobile push event callback received incomplete message"))
				return
			}
			events = append(events, store.MobilePushEvent{
				ID: uuid.NewString(), MessageID: message.ID,
				ConversationID: message.ConversationID, MessageSeq: message.Seq,
				Status: EventStatusQueued, NextAttemptAt: now,
				ExpiresAt: now.Add(pushJobTTL), CreatedAt: now, UpdatedAt: now,
			})
		}
		eventDB := tx.Session(&gorm.Session{NewDB: true}).Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "message_id"}}, DoNothing: true,
		})
		if err := eventDB.CreateInBatches(events, 100).Error; err != nil {
			tx.AddError(fmt.Errorf("enqueue mobile push event: %w", err))
		}
	})
}

func storedMessagesFromDestination(destination any) []store.Message {
	return appendStoredMessages(nil, reflect.ValueOf(destination))
}

func appendStoredMessages(result []store.Message, value reflect.Value) []store.Message {
	if !value.IsValid() {
		return result
	}
	for value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return result
		}
		value = value.Elem()
	}
	switch value.Kind() {
	case reflect.Struct:
		if value.Type() == storedMessageType && value.CanInterface() {
			return append(result, value.Interface().(store.Message))
		}
	case reflect.Array, reflect.Slice:
		for index := 0; index < value.Len(); index++ {
			result = appendStoredMessages(result, value.Index(index))
		}
	}
	return result
}
