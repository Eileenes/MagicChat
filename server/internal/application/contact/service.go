package contact

import (
	"context"
	"strings"
	"time"

	"app/internal/config"

	"gorm.io/gorm"
)

type Dependencies struct {
	DB                 *gorm.DB
	Apps               config.AppsConfig
	UserPresence       UserPresencePort
	AppPresence        AppPresencePort
	Settings           DirectorySettings
	NicknamePolicy     UserNicknamePolicy
	Notifications      FriendNotifications
	FriendshipMessages FriendshipMessageRecorder
	Now                func() time.Time
}

type Service struct {
	db                 *gorm.DB
	apps               config.AppsConfig
	userPresence       UserPresencePort
	appPresence        AppPresencePort
	settings           DirectorySettings
	nicknamePolicy     UserNicknamePolicy
	notifications      FriendNotifications
	friendshipMessages FriendshipMessageRecorder
	now                func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		db: deps.DB, apps: deps.Apps,
		userPresence: deps.UserPresence, appPresence: deps.AppPresence,
		settings: deps.Settings, notifications: deps.Notifications,
		nicknamePolicy:     deps.NicknamePolicy,
		friendshipMessages: deps.FriendshipMessages, now: now,
	}
}

func normalizeKeyword(keyword string) string {
	return strings.ToLower(strings.TrimSpace(keyword))
}

func (s *Service) userNicknameEditingAllowed(ctx context.Context) (bool, error) {
	if s.nicknamePolicy == nil {
		return true, nil
	}
	return s.nicknamePolicy.UserNicknameEditingAllowed(ctx)
}

var _ ClientService = (*Service)(nil)
var _ AppService = (*Service)(nil)
