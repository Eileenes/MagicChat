package httpserver

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"push-gateway/internal/gateway"
	"push-gateway/internal/model"
	"push-gateway/internal/provider"
	"push-gateway/internal/provider/fake"
	"push-gateway/internal/secure"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

func TestAPIRoutesInstallationGrantAndNotification(t *testing.T) {
	router := newTestRouter(t)
	registration := requestJSON(t, router, http.MethodPost, "/api/v1/installations", map[string]any{
		"provider": "fake", "provider_token": "provider-token-http",
		"platform": "android", "app_version": "1.0.0",
	}, nil)
	if registration.Code != http.StatusCreated {
		t.Fatalf("registration status = %d, body = %s", registration.Code, registration.Body.String())
	}
	var installation gateway.InstallationCredential
	decodeResponse(t, registration, &installation)
	if installation.InstallationID == "" || installation.ManagementToken == "" {
		t.Fatalf("installation credential = %#v", installation)
	}

	unauthorized := requestJSON(t, router, http.MethodPost,
		"/api/v1/installations/"+installation.InstallationID+"/active-grant", nil,
		map[string]string{"Authorization": "Installation wrong-token"})
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, body = %s", unauthorized.Code, unauthorized.Body.String())
	}
	grantResponse := requestJSON(t, router, http.MethodPost,
		"/api/v1/installations/"+installation.InstallationID+"/active-grant", nil,
		map[string]string{"Authorization": "Installation " + installation.ManagementToken})
	if grantResponse.Code != http.StatusCreated {
		t.Fatalf("grant status = %d, body = %s", grantResponse.Code, grantResponse.Body.String())
	}
	var grant gateway.GrantCredential
	decodeResponse(t, grantResponse, &grant)

	headers := map[string]string{
		"Authorization":   "Bearer " + grant.SendToken,
		"Idempotency-Key": "message-http-1:grant-http-1",
	}
	notification := requestJSON(t, router, http.MethodPost,
		"/api/v1/grants/"+grant.GrantID+"/notifications", map[string]any{
			"event": gateway.EventMessageCreated, "route_token": "route-token-http",
			"collapse_key": "conversation-http", "ttl_seconds": 120,
		}, headers)
	if notification.Code != http.StatusAccepted {
		t.Fatalf("notification status = %d, body = %s", notification.Code, notification.Body.String())
	}
	var first gateway.JobResult
	decodeResponse(t, notification, &first)
	duplicate := requestJSON(t, router, http.MethodPost,
		"/api/v1/grants/"+grant.GrantID+"/notifications", map[string]any{
			"event": gateway.EventMessageCreated, "route_token": "route-token-http",
		}, headers)
	var second gateway.JobResult
	decodeResponse(t, duplicate, &second)
	if duplicate.Code != http.StatusAccepted || !second.Duplicate || second.JobID != first.JobID {
		t.Fatalf("duplicate status/body = %d/%s", duplicate.Code, duplicate.Body.String())
	}
	metrics := requestJSON(t, router, http.MethodGet, "/api/metrics", nil, nil)
	for _, expected := range []string{
		`push_gateway_jobs{status="queued"} 1`,
		`push_gateway_grants{status="active"} 1`,
		`push_gateway_installations{provider="fake",platform="android",status="active"} 1`,
		"push_gateway_oldest_pending_job_age_seconds",
	} {
		if !strings.Contains(metrics.Body.String(), expected) {
			t.Fatalf("metrics do not contain %q: %s", expected, metrics.Body.String())
		}
	}
}

func TestClientAddressOnlyTrustsConfiguredProxy(t *testing.T) {
	_, trustedNetwork, err := net.ParseCIDR("10.0.0.0/8")
	if err != nil {
		t.Fatalf("parse network: %v", err)
	}
	server := &Server{trustedProxies: []*net.IPNet{trustedNetwork}}
	trustedRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	trustedRequest.RemoteAddr = "10.0.0.2:1234"
	trustedRequest.Header.Set("X-Forwarded-For", "203.0.113.5")
	if got := server.clientAddress(trustedRequest); got != "203.0.113.5" {
		t.Fatalf("trusted client address = %q", got)
	}
	untrustedRequest := httptest.NewRequest(http.MethodPost, "/", nil)
	untrustedRequest.RemoteAddr = "198.51.100.8:1234"
	untrustedRequest.Header.Set("X-Forwarded-For", "203.0.113.6")
	if got := server.clientAddress(untrustedRequest); got != "198.51.100.8" {
		t.Fatalf("untrusted client address = %q", got)
	}
}

func TestMalformedResourceIDReturnsBadRequest(t *testing.T) {
	router := newTestRouter(t)
	response := requestJSON(t, router, http.MethodPost, "/api/v1/installations/not-a-uuid/active-grant", nil,
		map[string]string{"Authorization": "Installation token"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("malformed ID status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestOperationalRoutesUseAPIPrefix(t *testing.T) {
	router := newTestRouter(t)
	for _, path := range []string{"/api/health/live", "/api/health/ready", "/api/metrics", "/api/openapi.json"} {
		response := requestJSON(t, router, http.MethodGet, path, nil, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, body = %s", path, response.Code, response.Body.String())
		}
	}
	if response := requestJSON(t, router, http.MethodGet, "/health/live", nil, nil); response.Code != http.StatusNotFound {
		t.Fatalf("unprefixed health status = %d", response.Code)
	}
}

func newTestRouter(t *testing.T) *echo.Echo {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.RateLimit{}, &model.Installation{}, &model.Grant{}, &model.Job{}); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	cipher, err := secure.NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	service, err := gateway.New(gateway.Options{
		DB: db, Cipher: cipher, Providers: []provider.Provider{fake.New()},
		Now: func() time.Time { return time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("create gateway: %v", err)
	}
	return New(db, service)
}

func requestJSON(t *testing.T, router http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var content []byte
	if body != nil {
		var err error
		content, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(content))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.Unmarshal(response.Body.Bytes(), target); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
}
