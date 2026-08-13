package directmessagepolicy

import (
	"context"
	"errors"

	"app/internal/store"

	"gorm.io/gorm"
)

var ErrFriendshipRequired = errors.New("direct messaging requires friendship")

type DirectorySettings interface {
	ContactDirectoryMode(context.Context) (string, error)
}

type Policy struct {
	settings DirectorySettings
}

func New(settings DirectorySettings) *Policy {
	return &Policy{settings: settings}
}

func (p *Policy) Require(db *gorm.DB, firstUserID, secondUserID string) error {
	if p == nil || p.settings == nil {
		return nil
	}
	mode, err := p.settings.ContactDirectoryMode(db.Statement.Context)
	if err != nil {
		return err
	}
	if mode != store.ContactDirectoryModeFriends {
		return nil
	}
	lowID, highID := firstUserID, secondUserID
	if lowID > highID {
		lowID, highID = highID, lowID
	}
	var count int64
	if err := db.Model(&store.UserFriendship{}).
		Where("user_id_low = ? AND user_id_high = ?", lowID, highID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return ErrFriendshipRequired
	}
	return nil
}
