package model

import "time"

const (
	InstallationStatusActive   = "active"
	InstallationStatusDisabled = "disabled"

	GrantStatusActive  = "active"
	GrantStatusRevoked = "revoked"
	GrantStatusExpired = "expired"

	JobStatusQueued   = "queued"
	JobStatusSending  = "sending"
	JobStatusRetry    = "retry"
	JobStatusAccepted = "accepted"
	JobStatusFailed   = "failed"
	JobStatusExpired  = "expired"
)

type RateLimit struct {
	Scope       string    `gorm:"primaryKey"`
	KeyHash     []byte    `gorm:"primaryKey"`
	WindowStart time.Time `gorm:"primaryKey"`
	Count       int64     `gorm:"not null"`
	UpdatedAt   time.Time `gorm:"not null;index"`
}

func (RateLimit) TableName() string { return "push_rate_limits" }

type Installation struct {
	ID                      string    `gorm:"type:uuid;primaryKey"`
	Provider                string    `gorm:"not null"`
	ProviderTokenCiphertext []byte    `gorm:"not null"`
	ProviderTokenHash       []byte    `gorm:"not null;uniqueIndex"`
	Platform                string    `gorm:"not null"`
	Environment             string    `gorm:"not null"`
	AppVersion              string    `gorm:"not null"`
	ManagementTokenHash     []byte    `gorm:"not null"`
	Status                  string    `gorm:"not null"`
	LastSeenAt              time.Time `gorm:"not null"`
	CreatedAt               time.Time `gorm:"not null"`
	UpdatedAt               time.Time `gorm:"not null;index:push_installations_retention_index"`
}

func (Installation) TableName() string { return "push_installations" }

type Grant struct {
	ID             string       `gorm:"type:uuid;primaryKey"`
	InstallationID string       `gorm:"type:uuid;not null;index"`
	Installation   Installation `gorm:"constraint:OnDelete:CASCADE;"`
	SendTokenHash  []byte       `gorm:"not null"`
	Status         string       `gorm:"not null;index:push_grants_retention_index,priority:1"`
	ExpiresAt      time.Time    `gorm:"not null"`
	LastUsedAt     *time.Time
	CreatedAt      time.Time `gorm:"not null"`
	UpdatedAt      time.Time `gorm:"not null;index:push_grants_retention_index,priority:2"`
	RevokedAt      *time.Time
}

func (Grant) TableName() string { return "push_grants" }

type Job struct {
	ID                string    `gorm:"type:uuid;primaryKey"`
	GrantID           string    `gorm:"type:uuid;not null;uniqueIndex:push_jobs_grant_idempotency_unique,priority:1"`
	Grant             Grant     `gorm:"constraint:OnDelete:CASCADE;"`
	IdempotencyKey    string    `gorm:"not null;uniqueIndex:push_jobs_grant_idempotency_unique,priority:2"`
	EventType         string    `gorm:"not null"`
	RouteToken        string    `gorm:"not null"`
	CollapseKey       string    `gorm:"not null"`
	Status            string    `gorm:"not null;index:push_jobs_dispatch_index,priority:1"`
	Attempts          int       `gorm:"not null"`
	NextAttemptAt     time.Time `gorm:"not null;index:push_jobs_dispatch_index,priority:2"`
	ExpiresAt         time.Time `gorm:"not null"`
	LockedAt          *time.Time
	LockToken         string    `gorm:"not null"`
	ProviderRequestID string    `gorm:"not null"`
	ProviderMessageID string    `gorm:"not null"`
	LastErrorCode     string    `gorm:"not null"`
	CreatedAt         time.Time `gorm:"not null;index:push_jobs_dispatch_index,priority:3"`
	UpdatedAt         time.Time `gorm:"not null"`
}

func (Job) TableName() string { return "push_jobs" }
