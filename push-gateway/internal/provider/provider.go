package provider

import (
	"context"
	"fmt"
	"time"
)

type Registration struct {
	Token       string
	Platform    string
	Environment string
}

type Notification struct {
	ID                string
	Token             string
	Platform          string
	Environment       string
	Title             string
	Body              string
	Event             string
	GrantID           string
	RouteToken        string
	CollapseKey       string
	RequestIdentifier string
	ExpiresAt         time.Time
}

type Receipt struct {
	MessageID string
}

type ErrorKind string

const (
	ErrorTransient     ErrorKind = "transient"
	ErrorInvalidDevice ErrorKind = "invalid_device"
	ErrorPermanent     ErrorKind = "permanent"
)

type SendError struct {
	Kind ErrorKind
	Code string
	Err  error
}

func (e *SendError) Error() string {
	if e.Err == nil {
		return fmt.Sprintf("provider send failed: %s", e.Code)
	}
	return fmt.Sprintf("provider send failed: %s: %v", e.Code, e.Err)
}

func (e *SendError) Unwrap() error { return e.Err }

// Provider implementations must honor cancellation and deadlines from ctx;
// the worker's lease safety assumes Send returns before its context expires.
type Provider interface {
	Name() string
	ValidateRegistration(Registration) error
	Send(context.Context, Notification) (Receipt, error)
}

// RequestIdentifierProvider obtains a provider-issued identifier that makes
// retries of the same accepted request idempotent. The worker persists it
// before the first send attempt.
type RequestIdentifierProvider interface {
	NewRequestIdentifier(context.Context) (string, error)
}
