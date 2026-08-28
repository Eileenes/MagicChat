package client

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"app/internal/application/account"
	"app/internal/application/accountdeactivation"
	"github.com/labstack/echo/v4"
)

type fakeDeactivationService struct {
	requestUserID, deactivateUserID, code string
	result                                accountdeactivation.Result
	requestErr, deactivateErr             error
}

func (f *fakeDeactivationService) RequestCode(_ context.Context, id string) (accountdeactivation.Result, error) {
	f.requestUserID = id
	return f.result, f.requestErr
}
func (f *fakeDeactivationService) Deactivate(_ context.Context, id, code string) error {
	f.deactivateUserID = id
	f.code = code
	return f.deactivateErr
}
func deactivationRouter(service *fakeDeactivationService) *echo.Echo {
	sessions := &fakeAccountService{authenticated: account.AuthenticatedSession{Account: account.Account{ID: "account-1", Email: "real@example.com"}}}
	auth := NewAccountAPI(sessions, sessions, nil)
	e := echo.New()
	g := e.Group("/api/client", auth.RequireSession)
	NewAccountDeactivationAPI(service).RegisterRoutes(g)
	return e
}

func TestDeactivationCodeRouteRequiresSessionAndRejectsEmailBody(t *testing.T) {
	service := &fakeDeactivationService{result: accountdeactivation.Result{ExpiresInSeconds: 900, RetryAfterSeconds: 5}}
	router := deactivationRouter(service)
	req := httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation/code", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("unauthenticated status=%d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation/code", strings.NewReader(`{"email":"attacker@example.com"}`))
	req.Header.Set("Authorization", "Bearer token")
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 400 || service.requestUserID != "" {
		t.Fatalf("injected body status=%d user=%q", rec.Code, service.requestUserID)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation/code", nil)
	req.Header.Set("Authorization", "Bearer token")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 200 || service.requestUserID != "account-1" {
		t.Fatalf("status=%d user=%q", rec.Code, service.requestUserID)
	}
}

func TestDeactivateStrictJSON(t *testing.T) {
	cases := []struct{ name, contentType, body string }{{"missing content type", "", `{"code":"12345678"}`}, {"wrong content type", "text/plain", `{"code":"12345678"}`}, {"empty", "application/json", ""}, {"unknown", "application/json", `{"code":"12345678","email":"x@example.com"}`}, {"multiple", "application/json", `{"code":"12345678"} {"code":"12345678"}`}, {"trailing", "application/json", `{"code":"12345678"} garbage`}, {"oversized", "application/json", `{"code":"` + strings.Repeat("1", 1100) + `"}`}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			service := &fakeDeactivationService{}
			router := deactivationRouter(service)
			req := httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer token")
			if tc.contentType != "" {
				req.Header.Set(echo.HeaderContentType, tc.contentType)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != 400 || service.deactivateUserID != "" {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
	service := &fakeDeactivationService{}
	router := deactivationRouter(service)
	req := httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation", bytes.NewBufferString(`{"code":"12345678"}`))
	req.Header.Set("Authorization", "Bearer token")
	req.Header.Set(echo.HeaderContentType, "application/json; charset=utf-8")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 200 || service.code != "12345678" {
		t.Fatalf("valid status=%d code=%q", rec.Code, service.code)
	}
}

func TestDeactivationBearerCookieErrorsAndClearCookie(t *testing.T) {
	service := &fakeDeactivationService{requestErr: &accountdeactivation.Error{Code: accountdeactivation.CodeTooManyRequests, Message: "slow", RetryAfter: 4}}
	router := deactivationRouter(service)
	req := httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation/code", nil)
	req.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: "cookie-token"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 429 || rec.Header().Get("Retry-After") != "4" {
		t.Fatalf("status=%d retry=%q", rec.Code, rec.Header().Get("Retry-After"))
	}
	service.requestErr = nil
	req = httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation", strings.NewReader(`{"code":"12345678"}`))
	req.AddCookie(&http.Cookie{Name: UserSessionCookieName, Value: "cookie-token"})
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("cookie status=%d", rec.Code)
	}
	found := false
	for _, c := range rec.Result().Cookies() {
		if c.Name == UserSessionCookieName && c.MaxAge < 0 {
			found = true
		}
	}
	if !found {
		t.Fatal("session cookie not cleared")
	}
	for _, tc := range []struct {
		err  error
		want int
	}{{&accountdeactivation.Error{Code: accountdeactivation.CodeInvalidRequest, Message: "bad"}, 400}, {&accountdeactivation.Error{Code: accountdeactivation.CodeInvalidCode, Message: "bad"}, 401}, {&accountdeactivation.Error{Code: accountdeactivation.CodeAccountNotActive, Message: "bad"}, 409}, {&accountdeactivation.Error{Code: accountdeactivation.CodeServiceUnavailable, Message: "bad"}, 503}, {errors.New("db"), 500}} {
		service.deactivateErr = tc.err
		req = httptest.NewRequest(http.MethodPost, "/api/client/me/deactivation", strings.NewReader(`{"code":"12345678"}`))
		req.Header.Set("Authorization", "Bearer token")
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec = httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("error %v status=%d want=%d", tc.err, rec.Code, tc.want)
		}
	}
}
