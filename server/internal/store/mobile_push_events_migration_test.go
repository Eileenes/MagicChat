package store

import (
	"os"
	"strings"
	"testing"
)

func TestMobilePushEventsMigrationDefinesTransactionalQueue(t *testing.T) {
	rawSQL, err := os.ReadFile("../../migrations/00036_add_mobile_push_events.sql")
	if err != nil {
		t.Fatalf("read mobile push events migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"create table mobile_push_events",
		"message_id uuid not null unique references message_registry(id) on delete cascade",
		"mobile_push_events_dispatch_index",
		"drop table mobile_push_events",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
}
