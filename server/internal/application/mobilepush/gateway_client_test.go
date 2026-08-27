package mobilepush

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGatewayClientSendsCapabilityRequest(t *testing.T) {
	var capturedAuthorization, capturedIdempotency string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/grants/grant-1/notifications" {
			t.Errorf("path = %q", request.URL.Path)
		}
		capturedAuthorization = request.Header.Get("Authorization")
		capturedIdempotency = request.Header.Get("Idempotency-Key")
		response.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	client := NewGatewayClientWithEndpoint(server.URL, server.Client())
	if err := client.Send(t.Context(), "grant-1", "send-secret", "job-1", NotificationRequest{
		Event: "message.created", RouteToken: "route-token", TTLSeconds: 300,
	}); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if capturedAuthorization != "Bearer send-secret" || capturedIdempotency != "job-1" {
		t.Fatalf("headers = %q/%q", capturedAuthorization, capturedIdempotency)
	}
}

func TestGatewayClientClassifiesResponses(t *testing.T) {
	tests := []struct {
		status int
		kind   GatewayErrorKind
	}{
		{status: http.StatusGone, kind: GatewayErrorRevoked},
		{status: http.StatusTooManyRequests, kind: GatewayErrorRetry},
		{status: http.StatusServiceUnavailable, kind: GatewayErrorRetry},
		{status: http.StatusBadRequest, kind: GatewayErrorInvalid},
	}
	for _, test := range tests {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(test.status)
			_, _ = response.Write([]byte(`{"error":{"code":"test_error"}}`))
		}))
		client := NewGatewayClientWithEndpoint(server.URL, server.Client())
		err := client.Send(t.Context(), "grant", "secret", "job", NotificationRequest{})
		server.Close()
		var gatewayErr *GatewayError
		if !errors.As(err, &gatewayErr) || gatewayErr.Kind != test.kind {
			t.Fatalf("status %d error = %#v", test.status, err)
		}
	}
}
