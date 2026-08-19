package httpserver

import (
	"context"

	contactapp "app/internal/application/contact"
	conversationapp "app/internal/application/conversation"

	"gorm.io/gorm"
)

func (s *Server) RecordFriendshipCreated(
	ctx context.Context,
	tx *gorm.DB,
	cmd contactapp.FriendshipMessageCommand,
) (contactapp.FriendshipMessageNotification, error) {
	result, err := s.conversations.RecordFriendshipCreated(ctx, tx, conversationapp.RecordFriendshipCreatedCommand{
		ActorUserID: cmd.ActorUserID, AddresseeUserID: cmd.AddresseeUserID,
		CreatedAt: cmd.CreatedAt, RequesterUserID: cmd.RequesterUserID,
	})
	if err != nil {
		return nil, err
	}
	return func(publishCtx context.Context) {
		s.conversations.PublishFriendshipCreated(publishCtx, result)
	}, nil
}
