package conversation

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"app/internal/application/conversationaccess"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	TopicListStatusAll      = "all"
	TopicListStatusActive   = "active"
	TopicListStatusArchived = "archived"
	defaultTopicListLimit   = 50
)

type topicListCursor struct {
	ActivityAt string `json:"activity_at"`
	ID         string `json:"id"`
}

func (s *Service) ListTopics(ctx context.Context, cmd ListTopicsCommand) (ListTopicsResult, error) {
	accountID := strings.TrimSpace(cmd.AccountID)
	if _, err := uuid.Parse(accountID); err != nil {
		return ListTopicsResult{}, invalidRequest("用户 ID 格式错误", err)
	}
	parentID, err := normalizeConversationID(cmd.ParentConversationID)
	if err != nil {
		return ListTopicsResult{}, invalidRequest(err.Error(), err)
	}
	limit, err := normalizeTopicListLimit(cmd.Limit)
	if err != nil {
		return ListTopicsResult{}, err
	}
	status, err := normalizeTopicListStatus(cmd.Status)
	if err != nil {
		return ListTopicsResult{}, err
	}
	cursor, err := decodeTopicListCursor(cmd.Cursor)
	if err != nil {
		return ListTopicsResult{}, invalidRequest("话题游标格式错误", err)
	}

	db := s.db.WithContext(ctx)
	parentAccess, err := conversationaccess.Load(db, parentID, false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ListTopicsResult{}, notFound("会话不存在", err)
	}
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}
	if parentAccess.IsTopic() {
		return ListTopicsResult{}, invalidRequest("话题下不能继续列出子话题", ErrTopicNested)
	}
	if parentAccess.Conversation.Status != store.ConversationStatusActive {
		return ListTopicsResult{}, forbidden("无权访问会话", ErrAccessDenied)
	}
	member, err := conversationaccess.RequireUserMember(db, parentAccess, accountID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ListTopicsResult{}, forbidden("无权访问会话", ErrAccessDenied)
	}
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}
	if err := conversationaccess.RequireUserDirectAppAccess(db, parentAccess, accountID); err != nil {
		if errors.Is(err, conversationaccess.ErrDirectAppAccessDenied) {
			return ListTopicsResult{}, forbidden("无权访问会话", ErrAccessDenied)
		}
		return ListTopicsResult{}, internalError(err)
	}
	visibleFromSeq := member.HistoryVisibleFromSeq
	if visibleFromSeq < 1 {
		visibleFromSeq = 1
	}

	activityExpression := "COALESCE(conversations.last_message_at, conversations.created_at)"
	query := db.Model(&store.Conversation{}).
		Select("conversations.*").
		Joins("JOIN conversation_topics ct ON ct.conversation_id = conversations.id").
		Where("ct.parent_conversation_id = ?", parentID).
		Where("ct.source_message_seq >= ?", visibleFromSeq).
		Where("conversations.status = ?", store.ConversationStatusActive)
	switch status {
	case TopicListStatusActive:
		query = query.Where("ct.archived_at IS NULL")
	case TopicListStatusArchived:
		query = query.Where("ct.archived_at IS NOT NULL")
	}
	if cursor != nil {
		query = query.Where(
			"("+activityExpression+" < ?) OR ("+activityExpression+" = ? AND conversations.id < ?)",
			cursor.ActivityAt, cursor.ActivityAt, cursor.ID,
		)
	}
	var conversations []store.Conversation
	if err := query.Order(activityExpression + " DESC").Order("conversations.id DESC").Limit(limit + 1).Find(&conversations).Error; err != nil {
		return ListTopicsResult{}, internalError(err)
	}

	var nextCursor *string
	if len(conversations) > limit {
		conversations = conversations[:limit]
		encoded, err := encodeTopicListCursor(conversations[len(conversations)-1])
		if err != nil {
			return ListTopicsResult{}, internalError(err)
		}
		nextCursor = &encoded
	}
	if len(conversations) == 0 {
		return ListTopicsResult{Topics: []Item{}, NextCursor: nextCursor}, nil
	}

	conversationIDs := make([]string, 0, len(conversations))
	for _, conversation := range conversations {
		conversationIDs = append(conversationIDs, conversation.ID)
	}
	membersByConversation, users, apps, err := s.loadListMembers(db, conversationIDs)
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}
	accessibleAppIDs, err := loadUserAccessibleAppIDSet(db, accountID, apps)
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}
	presentations, err := loadTopicPresentations(db, conversations, accountID)
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}
	lastMessageSenders, err := loadLastMessageSenders(db, conversations)
	if err != nil {
		return ListTopicsResult{}, internalError(err)
	}

	items := make([]Item, 0, len(conversations))
	for _, conversation := range conversations {
		presentation, ok := presentations[conversation.ID]
		if !ok {
			return ListTopicsResult{}, internalError(gorm.ErrRecordNotFound)
		}
		members := membersByConversation[conversation.ID]
		item := newTopicItem(conversation, accountID, members, users, apps, presentation)
		item.CanSend = canUserSendConversation(conversation, &presentation.parent, members, accessibleAppIDs)
		item.Members = nil
		item.LastMessageSender = lastMessageSenders[conversation.ID]
		if item.Topic != nil && !item.Topic.Participating {
			item.UnreadCount = 0
		}
		items = append(items, item)
	}
	return ListTopicsResult{Topics: items, NextCursor: nextCursor}, nil
}

func normalizeTopicListLimit(limit int) (int, error) {
	if limit == 0 {
		return defaultTopicListLimit, nil
	}
	if limit < 1 || limit > MaxClientListItems {
		return 0, invalidRequest("limit 必须为 1 到 100 的整数", nil)
	}
	return limit, nil
}

func normalizeTopicListStatus(status string) (string, error) {
	status = strings.TrimSpace(status)
	if status == "" {
		return TopicListStatusAll, nil
	}
	switch status {
	case TopicListStatusAll, TopicListStatusActive, TopicListStatusArchived:
		return status, nil
	default:
		return "", invalidRequest("status 必须为 all、active 或 archived", nil)
	}
}

func decodeTopicListCursor(raw string) (*struct {
	ActivityAt time.Time
	ID         string
}, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	content, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	var cursor topicListCursor
	if err := json.Unmarshal(content, &cursor); err != nil {
		return nil, err
	}
	activityAt, err := time.Parse(time.RFC3339Nano, cursor.ActivityAt)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(cursor.ID)
	if err != nil {
		return nil, err
	}
	return &struct {
		ActivityAt time.Time
		ID         string
	}{ActivityAt: activityAt, ID: id.String()}, nil
}

func encodeTopicListCursor(conversation store.Conversation) (string, error) {
	activityAt := conversation.CreatedAt
	if conversation.LastMessageAt != nil {
		activityAt = *conversation.LastMessageAt
	}
	content, err := json.Marshal(topicListCursor{
		ActivityAt: activityAt.Format(time.RFC3339Nano),
		ID:         conversation.ID,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(content), nil
}
