package migrations

import (
	"strings"
	"testing"
)

func TestProviderRequestIdentifierMigration(t *testing.T) {
	rawSQL, err := Files.ReadFile("00002_add_provider_request_id.sql")
	if err != nil {
		t.Fatalf("read provider request identifier migration: %v", err)
	}
	sql := strings.ToLower(string(rawSQL))
	for _, expected := range []string{
		"add column provider_request_id text not null default ''",
		"drop column provider_request_id",
	} {
		if !strings.Contains(sql, expected) {
			t.Fatalf("migration missing %q", expected)
		}
	}
}
