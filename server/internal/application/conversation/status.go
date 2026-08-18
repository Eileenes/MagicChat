package conversation

import (
	"context"
	"errors"

	"app/internal/application/conversationaccess"
	"app/internal/store"

	"gorm.io/gorm"
)

var (
	ErrStatusConversationNotFound = errors.New("conversation status conversation not found")
	ErrStatusAccessDenied         = errors.New("conversation status access denied")
	ErrStatusInvalidConversation  = errors.New("conversation status invalid conversation")
)

type StatusTarget struct {
	ID   string
	Type string
}

// ResolveStatusTarget validates a status sender and returns the sole recipient.
// It deliberately performs no writes: conversation statuses are transient.
func (s *Service) ResolveStatusTarget(ctx context.Context, conversationID, senderID, senderType string) (StatusTarget, error) {
	var conversation store.Conversation
	if err := s.db.WithContext(ctx).First(&conversation, "id = ?", conversationID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return StatusTarget{}, ErrStatusConversationNotFound
		}
		return StatusTarget{}, err
	}
	if conversation.Kind != store.ConversationKindDirect && conversation.Kind != store.ConversationKindApp {
		return StatusTarget{}, ErrStatusInvalidConversation
	}

	var members []store.ConversationMember
	if err := s.db.WithContext(ctx).Where("conversation_id = ? AND left_at IS NULL", conversation.ID).Find(&members).Error; err != nil {
		return StatusTarget{}, err
	}
	users, apps := 0, 0
	foundSender := false
	var target StatusTarget
	for _, member := range members {
		switch member.MemberType {
		case store.ConversationMemberTypeUser:
			users++
		case store.ConversationMemberTypeApp:
			apps++
		default:
			return StatusTarget{}, ErrStatusInvalidConversation
		}
		if member.MemberType == senderType && member.MemberID == senderID {
			foundSender = true
		} else {
			target = StatusTarget{ID: member.MemberID, Type: member.MemberType}
		}
	}
	if !foundSender {
		return StatusTarget{}, ErrStatusAccessDenied
	}
	if (conversation.Kind == store.ConversationKindDirect && (users != 2 || apps != 0)) ||
		(conversation.Kind == store.ConversationKindApp && (users != 1 || apps != 1)) || len(members) != 2 {
		return StatusTarget{}, ErrStatusInvalidConversation
	}
	access := conversationaccess.Context{Conversation: conversation, MembershipConversationID: conversation.ID}
	var err error
	if conversation.Kind == store.ConversationKindApp {
		if senderType == store.ConversationMemberTypeUser {
			err = conversationaccess.RequireUserDirectAppAccess(s.db.WithContext(ctx), access, senderID)
		} else {
			err = conversationaccess.RequireAppDirectUserAccess(s.db.WithContext(ctx), access, senderID)
		}
	}
	if errors.Is(err, conversationaccess.ErrDirectAppAccessDenied) {
		return StatusTarget{}, ErrStatusAccessDenied
	}
	if err != nil {
		return StatusTarget{}, err
	}
	return target, nil
}
