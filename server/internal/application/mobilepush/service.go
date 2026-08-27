package mobilepush

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	pushJobTTL       = 5 * time.Minute
	pushRouteTTL     = 7 * 24 * time.Hour
	maxSendToken     = 512
	minSendToken     = 32
	maxGrantLease    = 365 * 24 * time.Hour
	maxGrantsPerUser = 10
)

type Dependencies struct {
	DB      *gorm.DB
	Cipher  *TokenCipher
	Gateway GatewayClient
	Enabled bool
	Now     func() time.Time
}

type Service struct {
	db      *gorm.DB
	cipher  *TokenCipher
	gateway GatewayClient
	enabled bool
	now     func() time.Time
}

func NewService(deps Dependencies) (*Service, error) {
	if deps.DB == nil {
		return nil, errors.New("mobile push database is required")
	}
	if deps.Enabled && (deps.Cipher == nil || deps.Gateway == nil) {
		return nil, errors.New("mobile push cipher and gateway client are required when enabled")
	}
	now := deps.Now
	if now == nil {
		now = time.Now
	}
	return &Service{db: deps.DB, cipher: deps.Cipher, gateway: deps.Gateway, enabled: deps.Enabled, now: now}, nil
}

func (s *Service) Enabled() bool { return s.enabled }

func (s *Service) RegisterGrant(ctx context.Context, cmd RegisterGrantCommand) (Grant, error) {
	if !s.enabled {
		return Grant{}, failure("push_disabled", "当前服务未启用手机推送")
	}
	userID, err := normalizeUUID(cmd.UserID)
	if err != nil {
		return Grant{}, err
	}
	installationID, err := normalizeUUID(cmd.InstallationID)
	if err != nil {
		return Grant{}, err
	}
	gatewayGrantID, err := normalizeUUID(cmd.GatewayGrantID)
	if err != nil {
		return Grant{}, err
	}
	cmd.SendToken = strings.TrimSpace(cmd.SendToken)
	cmd.Platform = strings.TrimSpace(cmd.Platform)
	now := s.now().UTC()
	if len(cmd.SendToken) < minSendToken || len(cmd.SendToken) > maxSendToken ||
		(cmd.Platform != "android" && cmd.Platform != "ios") ||
		!cmd.ExpiresAt.After(now) || cmd.ExpiresAt.After(now.Add(maxGrantLease)) {
		return Grant{}, failure("invalid_request", "推送授权格式错误")
	}

	var stored store.UserPushGrant
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationKey(tx, "user:"+userID); err != nil {
			return err
		}
		if err := lockRegistrationKey(tx, "installation:"+installationID); err != nil {
			return err
		}
		if err := lockRegistrationKey(tx, "grant:"+gatewayGrantID); err != nil {
			return err
		}
		queryErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("installation_id = ?", installationID).First(&stored).Error
		switch {
		case queryErr == nil:
		case errors.Is(queryErr, gorm.ErrRecordNotFound):
			stored.ID = uuid.NewString()
			stored.CreatedAt = now
		default:
			return queryErr
		}
		var duplicateCount int64
		if err := tx.Model(&store.UserPushGrant{}).
			Where("gateway_grant_id = ? AND id <> ?", gatewayGrantID, stored.ID).
			Count(&duplicateCount).Error; err != nil {
			return err
		}
		if duplicateCount > 0 {
			return failure("grant_conflict", "推送授权已被其他安装实例使用")
		}
		if stored.UserID != userID {
			var userGrantCount int64
			if err := tx.Model(&store.UserPushGrant{}).
				Where("user_id = ? AND id <> ?", userID, stored.ID).
				Count(&userGrantCount).Error; err != nil {
				return err
			}
			if userGrantCount >= maxGrantsPerUser {
				return failure("grant_limit_reached", "当前账号绑定的推送设备数量已达上限")
			}
		}
		ciphertext, err := s.cipher.Encrypt(cmd.SendToken, []byte(stored.ID))
		if err != nil {
			return err
		}
		stored.UserID = userID
		stored.InstallationID = installationID
		stored.GatewayGrantID = gatewayGrantID
		stored.SendTokenCiphertext = ciphertext
		stored.Platform = cmd.Platform
		stored.ExpiresAt = cmd.ExpiresAt.UTC()
		stored.Status = GrantStatusActive
		stored.LastSeenAt = now
		stored.UpdatedAt = now
		return tx.Save(&stored).Error
	})
	if err != nil {
		return Grant{}, err
	}
	return Grant{
		InstallationID: stored.InstallationID, GatewayGrantID: stored.GatewayGrantID,
		Platform: stored.Platform, ExpiresAt: stored.ExpiresAt,
	}, nil
}

func (s *Service) RevokeGrant(ctx context.Context, userID, installationID string) error {
	userID, err := normalizeUUID(userID)
	if err != nil {
		return err
	}
	installationID, err = normalizeUUID(installationID)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).
		Where("user_id = ? AND installation_id = ?", userID, installationID).
		Delete(&store.UserPushGrant{}).Error
}

func (s *Service) ResolveRoute(ctx context.Context, userID, routeToken string) (Route, error) {
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
	if err := s.authorizeRoute(ctx, route); err != nil {
		return Route{}, err
	}
	return Route{ConversationID: route.ConversationID, MessageID: route.MessageID}, nil
}

func (s *Service) EnqueueMessage(ctx context.Context, delivery MessageDelivery) error {
	if !s.enabled || delivery.Muted || delivery.ActorUserID == delivery.UserID ||
		delivery.SenderType == store.MessageSenderTypeUser && delivery.SenderID == delivery.UserID {
		return nil
	}
	userID, err := normalizeUUID(delivery.UserID)
	if err != nil {
		return err
	}
	conversationID, err := normalizeUUID(delivery.ConversationID)
	if err != nil {
		return err
	}
	messageID, err := normalizeUUID(delivery.MessageID)
	if err != nil {
		return err
	}
	now := s.now().UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var grants []store.UserPushGrant
		if err := tx.Where(
			"user_id = ? AND status = ? AND expires_at > ?", userID, GrantStatusActive, now,
		).Find(&grants).Error; err != nil {
			return err
		}
		for _, grant := range grants {
			var count int64
			if err := tx.Model(&store.MobilePushJob{}).
				Where("grant_id = ? AND message_id = ?", grant.ID, messageID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			routeToken, err := randomToken()
			if err != nil {
				return err
			}
			jobID := uuid.NewString()
			routeCiphertext, err := s.cipher.Encrypt(routeToken, []byte(jobID))
			if err != nil {
				return err
			}
			route := store.MobilePushRoute{
				TokenHash: tokenHash(routeToken), UserID: userID,
				ConversationID: conversationID, MessageID: messageID,
				ExpiresAt: now.Add(pushRouteTTL), CreatedAt: now,
			}
			if err := tx.Create(&route).Error; err != nil {
				return err
			}
			job := store.MobilePushJob{
				ID: jobID, GrantID: grant.ID, UserID: userID,
				ConversationID: conversationID, MessageID: messageID,
				RouteTokenCiphertext: routeCiphertext, Status: JobStatusQueued,
				NextAttemptAt: now, ExpiresAt: now.Add(pushJobTTL),
				CreatedAt: now, UpdatedAt: now,
			}
			result := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "grant_id"}, {Name: "message_id"}}, DoNothing: true,
			}).Create(&job)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				if err := tx.Delete(&route).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (s *Service) authorizeRoute(ctx context.Context, route store.MobilePushRoute) error {
	db := s.db.WithContext(ctx)
	var registry store.MessageRegistry
	if err := db.Where(
		"id = ? AND conversation_id = ? AND deleted_at IS NULL", route.MessageID, route.ConversationID,
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

func lockRegistrationKey(tx *gorm.DB, value string) error {
	if tx.Dialector.Name() != "postgres" {
		return nil
	}
	digest := sha256.Sum256([]byte(value))
	key := int64(binary.BigEndian.Uint64(digest[:8]))
	return tx.Exec("SELECT pg_advisory_xact_lock(?)", key).Error
}

func normalizeUUID(value string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", failure("invalid_request", "资源 ID 格式错误")
	}
	return parsed.String(), nil
}
