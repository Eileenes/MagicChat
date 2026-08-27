package jpush

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"push-gateway/internal/provider"
)

func TestValidateRegistrationRequiresAndroidProduction(t *testing.T) {
	value, err := New(Config{AppKey: "app-key", MasterSecret: "master-secret"})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	valid := provider.Registration{
		Token: "registration-id-123456", Platform: "android", Environment: "production",
	}
	if err := value.ValidateRegistration(valid); err != nil {
		t.Fatalf("validate registration: %v", err)
	}
	for _, registration := range []provider.Registration{
		{Token: valid.Token, Platform: "ios", Environment: "production"},
		{Token: valid.Token, Platform: "android", Environment: "development"},
		{Token: "short", Platform: "android", Environment: "production"},
		{Token: "registration id with spaces", Platform: "android", Environment: "production"},
	} {
		if err := value.ValidateRegistration(registration); err == nil {
			t.Fatalf("registration unexpectedly valid: %#v", registration)
		}
	}
}

func TestSendUsesFixedTemplateAndAnonymousRouteData(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	var captured pushRequest
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v3/push" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		expectedAuthorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("app-key:master-secret"))
		if request.Header.Get("Authorization") != expectedAuthorization {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"sendno":"0","msg_id":"18100287008546343"}`))
	}))
	defer server.Close()
	value, err := New(Config{
		AppKey: "app-key", MasterSecret: "master-secret",
		Endpoint: server.URL + "/v3/push", Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	receipt, err := value.Send(t.Context(), provider.Notification{
		Token: "registration-id-123456", Platform: "android", Environment: "production",
		Title: "即应", Body: "你收到一条新消息", Event: "message.created",
		GrantID: "grant-opaque", RouteToken: "route-opaque",
		ExpiresAt: now.Add(125 * time.Second),
	})
	if err != nil {
		t.Fatalf("send notification: %v", err)
	}
	if receipt.MessageID != "18100287008546343" {
		t.Fatalf("receipt = %#v", receipt)
	}
	if captured.Platform != "android" || len(captured.Audience.RegistrationIDs) != 1 ||
		captured.Audience.RegistrationIDs[0] != "registration-id-123456" ||
		captured.Notification.Android.Title != "即应" ||
		captured.Notification.Android.Alert != "你收到一条新消息" ||
		captured.Notification.Android.ChannelID != "messages" ||
		captured.Options.TimeToLive != 125 {
		t.Fatalf("request payload = %#v", captured)
	}
	if captured.Notification.Android.Extras["event"] != "message.created" ||
		captured.Notification.Android.Extras["grant_id"] != "grant-opaque" ||
		captured.Notification.Android.Extras["route_token"] != "route-opaque" {
		t.Fatalf("request extras = %#v", captured.Notification.Android.Extras)
	}
}

func TestSendClassifiesJPushFailures(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		status   int
		body     string
		wantKind provider.ErrorKind
		wantCode string
	}{
		{name: "invalid registration", status: 400, body: `{"error":{"code":1003,"message":"invalid"}}`, wantKind: provider.ErrorInvalidDevice, wantCode: "jpush_1003"},
		{name: "no target", status: 400, body: `{"error":{"code":1011,"message":"missing"}}`, wantKind: provider.ErrorInvalidDevice, wantCode: "jpush_1011"},
		{name: "rate limited", status: 429, body: `{"error":{"code":2002,"message":"limited"}}`, wantKind: provider.ErrorTransient, wantCode: "jpush_2002"},
		{name: "timeout", status: 503, body: `{"error":{"code":1030,"message":"timeout"}}`, wantKind: provider.ErrorTransient, wantCode: "jpush_1030"},
		{name: "bad credential", status: 401, body: `{"error":{"code":1004,"message":"auth"}}`, wantKind: provider.ErrorPermanent, wantCode: "jpush_1004"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(testCase.status)
				_, _ = response.Write([]byte(testCase.body))
			}))
			defer server.Close()
			value, err := New(Config{
				AppKey: "app-key", MasterSecret: "master-secret", Endpoint: server.URL,
			})
			if err != nil {
				t.Fatalf("create provider: %v", err)
			}
			_, err = value.Send(t.Context(), provider.Notification{
				Token: "registration-id-123456", Platform: "android", Environment: "production",
				ExpiresAt: time.Now().Add(time.Minute),
			})
			var sendError *provider.SendError
			if !errors.As(err, &sendError) || sendError.Kind != testCase.wantKind || sendError.Code != testCase.wantCode {
				t.Fatalf("send error = %#v, want kind=%s code=%s", err, testCase.wantKind, testCase.wantCode)
			}
		})
	}
}

func TestSendPreservesContextCancellation(t *testing.T) {
	requestStarted := make(chan struct{})
	client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		close(requestStarted)
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	value, err := New(Config{
		AppKey: "app-key", MasterSecret: "master-secret",
		Endpoint: "https://api.example.test/v3/push", HTTPClient: client,
	})
	if err != nil {
		t.Fatalf("create provider: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	result := make(chan error, 1)
	go func() {
		_, sendErr := value.Send(ctx, provider.Notification{
			Token: "registration-id-123456", Platform: "android", Environment: "production",
			ExpiresAt: time.Now().Add(time.Minute),
		})
		result <- sendErr
	}()
	<-requestStarted
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("send cancellation = %v", err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (function roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
