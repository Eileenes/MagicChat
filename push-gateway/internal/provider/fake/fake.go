package fake

import (
	"context"

	"push-gateway/internal/provider"

	"github.com/google/uuid"
)

type Provider struct{}

func New() *Provider { return &Provider{} }

func (*Provider) Name() string { return "fake" }

func (*Provider) ValidateRegistration(provider.Registration) error { return nil }

func (*Provider) Send(context.Context, provider.Notification) (provider.Receipt, error) {
	return provider.Receipt{MessageID: "fake-" + uuid.NewString()}, nil
}
