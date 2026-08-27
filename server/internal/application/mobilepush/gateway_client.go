package mobilepush

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxGatewayResponseBytes = 16 << 10

type HTTPGatewayClient struct {
	endpoint   string
	httpClient *http.Client
}

func NewGatewayClient() *HTTPGatewayClient {
	return NewGatewayClientWithEndpoint(GatewayURL, &http.Client{Timeout: 5 * time.Second})
}

func NewGatewayClientWithEndpoint(endpoint string, client *http.Client) *HTTPGatewayClient {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &HTTPGatewayClient{endpoint: strings.TrimRight(endpoint, "/"), httpClient: client}
}

func (c *HTTPGatewayClient) Send(
	ctx context.Context,
	grantID string,
	sendToken string,
	idempotencyKey string,
	notification NotificationRequest,
) error {
	body, err := json.Marshal(notification)
	if err != nil {
		return &GatewayError{Kind: GatewayErrorInvalid, Code: "request_encoding_failed", Err: err}
	}
	requestURL := c.endpoint + "/api/v1/grants/" + url.PathEscape(grantID) + "/notifications"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return &GatewayError{Kind: GatewayErrorInvalid, Code: "request_creation_failed", Err: err}
	}
	request.Header.Set("Authorization", "Bearer "+sendToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", idempotencyKey)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return &GatewayError{Kind: GatewayErrorRetry, Code: "gateway_unavailable", Err: err}
	}
	defer response.Body.Close()
	content, readErr := io.ReadAll(io.LimitReader(response.Body, maxGatewayResponseBytes))
	if readErr != nil {
		return &GatewayError{Kind: GatewayErrorRetry, Code: "gateway_response_unreadable", Err: readErr}
	}
	if response.StatusCode == http.StatusAccepted {
		return nil
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(content, &envelope)
	code := strings.TrimSpace(envelope.Error.Code)
	if code == "" {
		code = fmt.Sprintf("gateway_http_%d", response.StatusCode)
	}
	kind := GatewayErrorInvalid
	switch {
	case response.StatusCode == http.StatusUnauthorized,
		response.StatusCode == http.StatusNotFound,
		response.StatusCode == http.StatusGone:
		kind = GatewayErrorRevoked
	case response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500:
		kind = GatewayErrorRetry
	}
	return &GatewayError{Kind: kind, Code: code, StatusCode: response.StatusCode}
}
