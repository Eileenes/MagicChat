package httpserver

import (
	"context"
	"encoding/json"
	"testing"

	settingsapp "app/internal/application/settings"
	"app/internal/store"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestMaskNicknameFieldsOnlyMasksUserIdentities(t *testing.T) {
	payload := json.RawMessage(`{
		"sender":{"id":"user-1","type":"user","name":"Alice Zhang","nickname":"Alice"},
		"delegated_by":{"id":"app-1","type":"app","name":"Assistant","nickname":"Helper"}
	}`)

	masked, err := maskNicknameFields(payload)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Sender struct {
			Nickname string `json:"nickname"`
		} `json:"sender"`
		DelegatedBy struct {
			Nickname string `json:"nickname"`
		} `json:"delegated_by"`
	}
	if err := json.Unmarshal(masked, &value); err != nil {
		t.Fatal(err)
	}
	if value.Sender.Nickname != "Alice Zhang" {
		t.Fatalf("user nickname = %q, want real name", value.Sender.Nickname)
	}
	if value.DelegatedBy.Nickname != "Helper" {
		t.Fatalf("app nickname = %q, want unchanged", value.DelegatedBy.Nickname)
	}
}

func TestWithAppEventPayloadUsesCurrentNicknamePolicy(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:app-event-nickname-policy?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&store.AppSettings{}); err != nil {
		t.Fatal(err)
	}
	policy := settingsapp.NewService(settingsapp.Dependencies{DB: db})
	disabled := false
	if _, err := policy.Update(context.Background(), settingsapp.UpdateCommand{
		AppName: store.DefaultAppName, OrganizationName: store.DefaultOrganizationName,
		AllowUserNicknameEditing: &disabled,
	}); err != nil {
		t.Fatal(err)
	}
	server := &Server{settings: policy}
	payload := json.RawMessage(`{"sender":{"type":"user","name":"Alice Zhang","nickname":"Alice"}}`)
	var delivered json.RawMessage
	if err := server.withAppEventPayload(context.Background(), payload, func(value json.RawMessage) error {
		delivered = value
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var value struct {
		Sender struct {
			Nickname string `json:"nickname"`
		} `json:"sender"`
	}
	if err := json.Unmarshal(delivered, &value); err != nil {
		t.Fatal(err)
	}
	if value.Sender.Nickname != "Alice Zhang" {
		t.Fatalf("delivered nickname = %q, want real name", value.Sender.Nickname)
	}
}
