package store

import (
	"os"
	"strings"
	"testing"
)

func TestMobilePushMigrationDefinesGrantRouteAndJobTables(t *testing.T) {
	rawSQL, err := os.ReadFile("../../migrations/00035_add_mobile_push.sql")
	if err != nil {
		t.Fatalf("read mobile push migration: %v", err)
	}
	sql := normalizeSQL(string(rawSQL))
	for _, required := range []string{
		"create table user_push_grants",
		"installation_id uuid not null unique",
		"gateway_grant_id uuid not null unique",
		"send_token_ciphertext bytea not null",
		"create table mobile_push_routes",
		"create table mobile_push_jobs",
		"route_token_ciphertext bytea not null",
		"unique (grant_id, message_id)",
		"lock_token text not null default ''",
		"drop table mobile_push_jobs",
		"drop table mobile_push_routes",
		"drop table user_push_grants",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("mobile push migration missing %q", required)
		}
	}
}
