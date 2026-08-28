package mobilepush

import (
	"context"
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

type routeService struct {
	db  *gorm.DB
	now func() time.Time
}

func (s *routeService) Resolve(ctx context.Context, userID, routeToken string) (Route, error) {
	userID, err := normalizeUUID(userID)
	if err != nil {
		return Route{}, err
	}
	routeToken = strings.TrimSpace(routeToken)
	if len(routeToken) < 32 || len(routeToken) > 128 {
		return Route{}, failure("invalid_request", "推送路由格式错误")
	}
	now := s.now().UTC()
	var route store.MobilePushRoute
	if err := s.db.WithContext(ctx).Where(
		"token_hash = ? AND user_id = ? AND expires_at > ?", tokenHash(routeToken), userID, now,
	).First(&route).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return Route{}, failure("route_not_found", "推送路由不存在")
		}
		return Route{}, err
	}
	if err := s.authorize(ctx, route); err != nil {
		return Route{}, err
	}
	return Route{ConversationID: route.ConversationID, MessageID: route.MessageID}, nil
}

func (s *routeService) authorize(ctx context.Context, route store.MobilePushRoute) error {
	db := s.db.WithContext(ctx)
	var registry store.MessageRegistry
	if err := db.Where(
		"id = ? AND conversation_id = ? AND deleted_at IS NULL AND revoked_at IS NULL", route.MessageID, route.ConversationID,
	).First(&registry).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure("route_not_found", "推送路由不存在")
		}
		return err
	}
	var conversation store.Conversation
	if err := db.First(&conversation, "id = ? AND status = ?", route.ConversationID, store.ConversationStatusActive).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure("route_not_found", "推送路由不存在")
		}
		return err
	}
	membershipConversationID := conversation.ID
	var participant *store.ConversationTopicParticipant
	if conversation.Kind == store.ConversationKindTopic {
		var topic store.ConversationTopic
		if err := db.First(&topic, "conversation_id = ?", conversation.ID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return failure("route_not_found", "推送路由不存在")
			}
			return err
		}
		var parent store.Conversation
		if err := db.First(&parent, "id = ? AND status = ?", topic.ParentConversationID, store.ConversationStatusActive).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return failure("route_not_found", "推送路由不存在")
			}
			return err
		}
		membershipConversationID = parent.ID
		var value store.ConversationTopicParticipant
		query := db.Where(
			"conversation_id = ? AND participant_type = ? AND participant_id = ?",
			conversation.ID, store.ConversationMemberTypeUser, route.UserID,
		).Limit(1).Find(&value)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			participant = &value
		}
	}
	var member store.ConversationMember
	if err := db.First(&member,
		"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
		membershipConversationID, store.ConversationMemberTypeUser, route.UserID,
	).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure("route_not_found", "推送路由不存在")
		}
		return err
	}
	visibleFromSeq := member.HistoryVisibleFromSeq
	if participant != nil {
		visibleFromSeq = participant.HistoryVisibleFromSeq
	}
	if visibleFromSeq < 1 {
		visibleFromSeq = 1
	}
	if registry.Seq < visibleFromSeq {
		return failure("route_not_found", "推送路由不存在")
	}
	return nil
}
