package account

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"app/internal/store"

	"github.com/google/uuid"
)

func TestPostgresVerifiedEmailLoginCreatesAccountWithExpressionEmailIndex(t *testing.T) {
	baseDSN := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if baseDSN == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	baseDB, err := store.OpenPostgres(baseDSN)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}

	schema := "account_verified_email_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`).Error
	})

	parsedDSN, err := url.Parse(baseDSN)
	if err != nil {
		t.Fatalf("parse postgres dsn: %v", err)
	}
	query := parsedDSN.Query()
	query.Set("search_path", schema)
	parsedDSN.RawQuery = query.Encode()
	db, err := store.OpenPostgres(parsedDSN.String())
	if err != nil {
		t.Fatalf("open schema postgres: %v", err)
	}
	if err := store.RunPostgresMigrations(db, "../../../migrations"); err != nil {
		t.Fatalf("migrate postgres test schema: %v", err)
	}

	now := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	service := NewService(Dependencies{
		DB: db, Now: func() time.Time { return now },
		GenerateSessionToken: func() (string, error) { return "postgres-verified-email-session", nil },
	})
	result, err := service.LoginWithVerifiedEmail(context.Background(), VerifiedEmailLoginCommand{
		Email: "New.User@Example.com", UserAgent: "postgres-test", IP: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("verified email registration: %v", err)
	}
	if result.Account.Email != "new.user@example.com" || result.Account.Name != "new.user" {
		t.Fatalf("registered account = %#v", result.Account)
	}

	var userCount int64
	if err := db.Model(&store.User{}).Where("lower(email) = ?", "new.user@example.com").Count(&userCount).Error; err != nil {
		t.Fatalf("count registered users: %v", err)
	}
	if userCount != 1 {
		t.Fatalf("registered user count = %d, want 1", userCount)
	}
	var workspaceCount int64
	if err := db.Model(&store.Project{}).
		Where("owner_user_id = ? AND is_personal = ?", result.Account.ID, true).
		Count(&workspaceCount).Error; err != nil {
		t.Fatalf("count personal workspaces: %v", err)
	}
	if workspaceCount != 1 {
		t.Fatalf("personal workspace count = %d, want 1", workspaceCount)
	}
}
