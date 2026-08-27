package mobilepush

import (
	"context"
	"time"
)

const GatewayURL = "https://push.jiying.chat"

const (
	GrantStatusActive   = "active"
	GrantStatusDisabled = "disabled"

	JobStatusQueued  = "queued"
	JobStatusSending = "sending"
	JobStatusRetry   = "retry"
	JobStatusSent    = "sent"
	JobStatusFailed  = "failed"
	JobStatusExpired = "expired"
)

type RegisterGrantCommand struct {
	UserID         string
	InstallationID string
	GatewayGrantID string
	SendToken      string
	Platform       string
	ExpiresAt      time.Time
}

type Grant struct {
	InstallationID string
	GatewayGrantID string
	Platform       string
	ExpiresAt      time.Time
}

type MessageDelivery struct {
	UserID         string
	ActorUserID    string
	ConversationID string
	MessageID      string
	SenderType     string
	SenderID       string
	Muted          bool
}

type Route struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
}

type NotificationRequest struct {
	Event       string `json:"event"`
	RouteToken  string `json:"route_token"`
	CollapseKey string `json:"collapse_key,omitempty"`
	TTLSeconds  int    `json:"ttl_seconds"`
}

type GatewayErrorKind string

const (
	GatewayErrorRetry   GatewayErrorKind = "retry"
	GatewayErrorRevoked GatewayErrorKind = "revoked"
	GatewayErrorInvalid GatewayErrorKind = "invalid"
)

type GatewayError struct {
	Kind       GatewayErrorKind
	Code       string
	StatusCode int
	Err        error
}

func (e *GatewayError) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func (e *GatewayError) Unwrap() error { return e.Err }

type GatewayClient interface {
	Send(context.Context, string, string, string, NotificationRequest) error
}

type ClientService interface {
	RegisterGrant(context.Context, RegisterGrantCommand) (Grant, error)
	RevokeGrant(context.Context, string, string) error
	ResolveRoute(context.Context, string, string) (Route, error)
}
