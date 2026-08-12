package usermanagement

import (
	"context"
	"time"
)

type PresencePort interface {
	OnlineStatus([]string) map[string]bool
	IsOnline(string) bool
	CloseUser(string) int
}

type ProfileNotifications interface {
	PublishUserProfileUpdated(context.Context, string, time.Time)
}

type AppConnectionPort interface {
	CloseApp(string) int
}
