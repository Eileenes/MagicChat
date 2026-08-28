package store

import (
	"os"
	"strings"
	"testing"
)

func TestMobilePushSessionMigrationRevokesLegacyGrantsAndBindsSessions(t *testing.T) {
	rawSQL, err := os.ReadFile("../../migrations/00037_bind_mobile_push_grants_to_sessions.sql")
	if err != nil {
		t.Fatalf("read mobile push session migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"delete from user_push_grants",
		"session_id uuid not null references user_sessions(id) on delete cascade",
		"user_push_grants_session_index",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
}
