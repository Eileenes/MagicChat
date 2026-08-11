package contact

import (
	"strings"
	"time"

	"app/internal/config"

	"gorm.io/gorm"
)

type Dependencies struct {
	DB            *gorm.DB
	Apps          config.AppsConfig
	UserPresence  UserPresencePort
	AppPresence   AppPresencePort
	Settings      DirectorySettings
	Notifications FriendNotifications
	Now           func() time.Time
}

type Service struct {
	db            *gorm.DB
	apps          config.AppsConfig
	userPresence  UserPresencePort
	appPresence   AppPresencePort
	settings      DirectorySettings
	notifications FriendNotifications
	now           func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		db: deps.DB, apps: deps.Apps,
		userPresence: deps.UserPresence, appPresence: deps.AppPresence,
		settings: deps.Settings, notifications: deps.Notifications, now: now,
	}
}

func normalizeKeyword(keyword string) string {
	return strings.ToLower(strings.TrimSpace(keyword))
}

var _ ClientService = (*Service)(nil)
var _ AppService = (*Service)(nil)
