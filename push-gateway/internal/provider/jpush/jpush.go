package jpush

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"

	"push-gateway/internal/provider"
)

const (
	providerName       = "jpush"
	pushEndpoint       = "https://api.jpush.cn/v3/push"
	cidEndpoint        = "https://api.jpush.cn/v3/push/cid"
	maxResponseBytes   = 1 << 20
	maxTokenBytes      = 255
	maxAppKeyBytes     = 128
	maxSecretBytes     = 256
	maxNotificationTTL = 10 * 24 * time.Hour
)

type Config struct {
	AppKey       string
	MasterSecret string
	HTTPClient   *http.Client
	Endpoint     string
	CIDEndpoint  string
	Now          func() time.Time
}

type Provider struct {
	authorization string
	client        *http.Client
	endpoint      string
	cidEndpoint   string
	now           func() time.Time
}

func New(config Config) (*Provider, error) {
	appKey := strings.TrimSpace(config.AppKey)
	masterSecret := strings.TrimSpace(config.MasterSecret)
	if appKey == "" || len(appKey) > maxAppKeyBytes || masterSecret == "" || len(masterSecret) > maxSecretBytes {
		return nil, errors.New("JPush app key and master secret are required")
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{}
	}
	endpoint := strings.TrimSpace(config.Endpoint)
	if endpoint == "" {
		endpoint = pushEndpoint
	}
	configuredCIDEndpoint := strings.TrimSpace(config.CIDEndpoint)
	if configuredCIDEndpoint == "" {
		configuredCIDEndpoint = cidEndpoint
	}
	now := config.Now
	if now == nil {
		now = time.Now
	}
	credential := base64.StdEncoding.EncodeToString([]byte(appKey + ":" + masterSecret))
	return &Provider{
		authorization: "Basic " + credential,
		client:        client,
		endpoint:      endpoint,
		cidEndpoint:   configuredCIDEndpoint,
		now:           now,
	}, nil
}

func (*Provider) Name() string { return providerName }

func (*Provider) ValidateRegistration(registration provider.Registration) error {
	if registration.Platform != "android" || registration.Environment != "production" {
		return errors.New("JPush registration must target Android production")
	}
	token := strings.TrimSpace(registration.Token)
	if len(token) < 8 || len(token) > maxTokenBytes {
		return errors.New("invalid JPush registration ID length")
	}
	for _, value := range token {
		if unicode.IsSpace(value) || unicode.IsControl(value) {
			return errors.New("invalid JPush registration ID")
		}
	}
	return nil
}

func (p *Provider) Send(ctx context.Context, notification provider.Notification) (provider.Receipt, error) {
	if err := p.ValidateRegistration(provider.Registration{
		Token: notification.Token, Platform: notification.Platform, Environment: notification.Environment,
	}); err != nil {
		return provider.Receipt{}, &provider.SendError{
			Kind: provider.ErrorInvalidDevice, Code: "invalid_registration_id", Err: err,
		}
	}
	payload := pushRequest{
		CID:      strings.TrimSpace(notification.RequestIdentifier),
		Platform: "android",
		Audience: pushAudience{RegistrationIDs: []string{strings.TrimSpace(notification.Token)}},
		Notification: pushNotification{Android: androidNotification{
			Alert:     notification.Body,
			Title:     notification.Title,
			ChannelID: "messages",
			Extras: map[string]string{
				"event":        notification.Event,
				"grant_id":     notification.GrantID,
				"route_token":  notification.RouteToken,
				"collapse_key": notification.CollapseKey,
			},
		}},
		Options: pushOptions{TimeToLive: notificationTTL(notification.ExpiresAt, p.now().UTC())},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return provider.Receipt{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return provider.Receipt{}, err
	}
	request.Header.Set("Authorization", p.authorization)
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := p.client.Do(request)
	if err != nil {
		return provider.Receipt{}, classifyTransportError(err)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if readErr != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorTransient, Code: "response_read_failed", Err: readErr}
	}
	if len(responseBody) > maxResponseBytes {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorPermanent, Code: "response_too_large"}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return provider.Receipt{}, classifyResponseError(response.StatusCode, responseBody)
	}
	var result pushResponse
	decoder := json.NewDecoder(bytes.NewReader(responseBody))
	decoder.UseNumber()
	if err := decoder.Decode(&result); err != nil {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorTransient, Code: "invalid_response", Err: err}
	}
	messageID := normalizeMessageID(result.MessageID)
	if messageID == "" {
		return provider.Receipt{}, &provider.SendError{Kind: provider.ErrorTransient, Code: "invalid_response"}
	}
	return provider.Receipt{MessageID: messageID}, nil
}

type pushRequest struct {
	CID          string           `json:"cid,omitempty"`
	Platform     string           `json:"platform"`
	Audience     pushAudience     `json:"audience"`
	Notification pushNotification `json:"notification"`
	Options      pushOptions      `json:"options"`
}

type pushAudience struct {
	RegistrationIDs []string `json:"registration_id"`
}

type pushNotification struct {
	Android androidNotification `json:"android"`
}

type androidNotification struct {
	Alert     string            `json:"alert"`
	Title     string            `json:"title"`
	ChannelID string            `json:"channel_id"`
	Extras    map[string]string `json:"extras"`
}

type pushOptions struct {
	TimeToLive int `json:"time_to_live"`
}

type pushResponse struct {
	MessageID any `json:"msg_id"`
}

type cidResponse struct {
	CIDList []string `json:"cidlist"`
}

type errorResponse struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (p *Provider) NewRequestIdentifier(ctx context.Context) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.cidEndpoint+"?count=1&type=push", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", p.authorization)
	response, err := p.client.Do(request)
	if err != nil {
		return "", classifyTransportError(err)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if readErr != nil {
		return "", &provider.SendError{Kind: provider.ErrorTransient, Code: "cid_response_read_failed", Err: readErr}
	}
	if len(body) > maxResponseBytes {
		return "", &provider.SendError{Kind: provider.ErrorPermanent, Code: "cid_response_too_large"}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", classifyResponseError(response.StatusCode, body)
	}
	var result cidResponse
	if err := json.Unmarshal(body, &result); err != nil || len(result.CIDList) != 1 {
		return "", &provider.SendError{Kind: provider.ErrorTransient, Code: "invalid_cid_response", Err: err}
	}
	identifier := strings.TrimSpace(result.CIDList[0])
	if identifier == "" || len(identifier) > 512 {
		return "", &provider.SendError{Kind: provider.ErrorTransient, Code: "invalid_cid_response"}
	}
	return identifier, nil
}

func notificationTTL(expiresAt, now time.Time) int {
	remaining := expiresAt.Sub(now)
	if remaining <= 0 {
		return 0
	}
	if remaining > maxNotificationTTL {
		remaining = maxNotificationTTL
	}
	return int((remaining + time.Second - 1) / time.Second)
}

func normalizeMessageID(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func classifyTransportError(err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return &provider.SendError{Kind: provider.ErrorTransient, Code: "network_error", Err: err}
}

func classifyResponseError(status int, body []byte) error {
	var response errorResponse
	_ = json.Unmarshal(body, &response)
	code := response.Error.Code
	codeLabel := fmt.Sprintf("jpush_%d", code)
	if code == 0 {
		codeLabel = fmt.Sprintf("http_%d", status)
	}
	kind := provider.ErrorPermanent
	switch {
	case code == 1011:
		kind = provider.ErrorInvalidDevice
	case code == 1000 || code == 1012 || code == 1030 || code == 2002:
		kind = provider.ErrorTransient
	case status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500:
		kind = provider.ErrorTransient
	}
	message := strings.TrimSpace(response.Error.Message)
	var cause error
	if message != "" {
		cause = errors.New(message)
	}
	return &provider.SendError{Kind: kind, Code: codeLabel, Err: cause}
}
