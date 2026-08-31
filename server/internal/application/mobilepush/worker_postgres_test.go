package mobilepush

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	accountapp "app/internal/application/account"
	"app/internal/auth"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestPostgresEventClaimsAreDisjointAndRecoverStaleLease(t *testing.T) {
	service, db, now := newPostgresPushTestService(t)
	first := insertPushUser(t, db, "push-postgres-first@example.com")
	second := insertPushUser(t, db, "push-postgres-second@example.com")
	conversation := insertPushConversation(t, db, first, second, now)
	for sequence := int64(1); sequence <= 4; sequence++ {
		insertPostgresPushMessage(t, db, conversation.ID, first.ID, sequence, now)
	}

	start := make(chan struct{})
	claims := make(chan []store.MobilePushEvent, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			events, err := service.claimEvents(t.Context(), 2)
			claims <- events
			errors <- err
		}()
	}
	close(start)
	workers.Wait()
	close(claims)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatalf("claim events: %v", err)
		}
	}
	claimedIDs := map[string]struct{}{}
	for batch := range claims {
		if len(batch) != 2 {
			t.Fatalf("claimed batch size = %d, want 2", len(batch))
		}
		for _, event := range batch {
			if _, exists := claimedIDs[event.ID]; exists {
				t.Fatalf("event %s was claimed by multiple workers", event.ID)
			}
			claimedIDs[event.ID] = struct{}{}
		}
	}
	if len(claimedIDs) != 4 {
		t.Fatalf("unique claimed events = %d, want 4", len(claimedIDs))
	}

	staleMessage := insertPostgresPushMessage(t, db, conversation.ID, first.ID, 5, now)
	staleLockTime := now.Add(-workerLease - time.Second)
	if err := db.Model(&store.MobilePushEvent{}).Where("message_id = ?", staleMessage.ID).
		Updates(map[string]any{
			"status": EventStatusExpanding, "locked_at": staleLockTime,
			"lock_token": uuid.NewString(), "updated_at": staleLockTime,
		}).Error; err != nil {
		t.Fatalf("make event lease stale: %v", err)
	}
	reclaimed, err := service.claimEvents(t.Context(), 1)
	if err != nil {
		t.Fatalf("reclaim stale event: %v", err)
	}
	if len(reclaimed) != 1 || reclaimed[0].MessageID != staleMessage.ID || reclaimed[0].Attempts != 1 {
		t.Fatalf("reclaimed events = %#v", reclaimed)
	}
}

func TestPostgresLogoutAndGrantRegistrationLeaveNoLiveGrant(t *testing.T) {
	service, db, now := newPostgresPushTestService(t)
	user := insertPushUser(t, db, "push-logout-race@example.com")
	token := "postgres-logout-race-token"
	session := store.UserSession{
		ID: uuid.NewString(), TokenHash: auth.HashSessionToken(token), UserID: user.ID,
		ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now,
	}
	if err := db.Create(&session).Error; err != nil {
		t.Fatalf("create logout race session: %v", err)
	}
	installationID := uuid.NewString()
	start := make(chan struct{})
	registerResult := make(chan error, 1)
	logoutResult := make(chan error, 1)
	go func() {
		<-start
		_, err := registerPushTestGrant(t, service, db, RegisterGrantCommand{
			UserID: user.ID, SessionID: session.ID,
			InstallationID: installationID, GatewayGrantID: uuid.NewString(),
			SendToken: strings.Repeat("s", 43), Platform: "ios",
			ExpiresAt: now.Add(30 * 24 * time.Hour),
		})
		registerResult <- err
	}()
	go func() {
		<-start
		accounts := accountapp.NewService(accountapp.Dependencies{
			DB: db, Now: func() time.Time { return now },
		})
		logoutResult <- accounts.Logout(t.Context(), accountapp.LogoutCommand{
			Token: token, InstallationID: installationID,
		})
	}()
	close(start)
	registerErr := <-registerResult
	if registerErr != nil && ErrorCodeOf(registerErr) != "unauthorized" {
		t.Fatalf("register grant during logout: %v", registerErr)
	}
	if err := <-logoutResult; err != nil {
		t.Fatalf("logout during grant registration: %v", err)
	}
	var sessionCount int64
	if err := db.Model(&store.UserSession{}).Where("id = ?", session.ID).Count(&sessionCount).Error; err != nil {
		t.Fatalf("count logout race session: %v", err)
	}
	var grantCount int64
	if err := db.Model(&store.UserPushGrant{}).Where("installation_id = ?", installationID).Count(&grantCount).Error; err != nil {
		t.Fatalf("count logout race grant: %v", err)
	}
	if sessionCount != 0 || grantCount != 0 {
		t.Fatalf("logout race left session=%d grants=%d", sessionCount, grantCount)
	}
}

func TestPostgresMessageEventFailureRollsBackMessage(t *testing.T) {
	_, db, now := newPostgresPushTestService(t)
	first := insertPushUser(t, db, "push-rollback-first@example.com")
	second := insertPushUser(t, db, "push-rollback-second@example.com")
	conversation := insertPushConversation(t, db, first, second, now)
	if err := db.Migrator().DropTable(&store.MobilePushEvent{}); err != nil {
		t.Fatalf("drop mobile push events: %v", err)
	}
	message := postgresPushMessage(conversation.ID, first.ID, 1, now)
	if err := db.Transaction(func(tx *gorm.DB) error {
		return tx.Create(&message).Error
	}); err == nil {
		t.Fatal("message creation succeeded without transactional event table")
	}
	var count int64
	if err := db.Model(&store.Message{}).Where("id = ?", message.ID).Count(&count).Error; err != nil {
		t.Fatalf("count rolled back message: %v", err)
	}
	if count != 0 {
		t.Fatalf("rolled back message count = %d, want 0", count)
	}
}

func newPostgresPushTestService(t *testing.T) (*Service, *gorm.DB, time.Time) {
	t.Helper()
	baseDSN := strings.TrimSpace(os.Getenv("POSTGRES_TEST_DSN"))
	if baseDSN == "" {
		t.Skip("POSTGRES_TEST_DSN is not configured")
	}
	baseDB, err := store.OpenPostgres(baseDSN)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	schema := "mobile_push_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		t.Fatalf("open postgres schema: %v", err)
	}
	if err := store.RunPostgresMigrations(db, "../../../migrations"); err != nil {
		t.Fatalf("migrate postgres schema: %v", err)
	}
	cipher, err := NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create push cipher: %v", err)
	}
	now := time.Now().UTC()
	service, err := NewService(Dependencies{
		DB: db, Cipher: cipher, Gateway: &fakeGateway{}, Enabled: true,
		Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create push service: %v", err)
	}
	return service, db, now
}

func insertPostgresPushMessage(
	t *testing.T,
	db *gorm.DB,
	conversationID string,
	senderID string,
	sequence int64,
	now time.Time,
) store.Message {
	t.Helper()
	message := postgresPushMessage(conversationID, senderID, sequence, now)
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("create postgres push message: %v", err)
	}
	return message
}

func postgresPushMessage(
	conversationID string,
	senderID string,
	sequence int64,
	now time.Time,
) store.Message {
	clientMessageID := fmt.Sprintf("push-postgres-%d-%s", sequence, uuid.NewString())
	return store.Message{
		ID: uuid.NewString(), ConversationID: conversationID, Seq: sequence,
		SenderType: store.MessageSenderTypeUser, SenderID: &senderID,
		ClientMessageID: &clientMessageID,
		Body:            json.RawMessage(`{"type":"text","content":"push"}`),
		Summary:         "push", CreatedAt: now, UpdatedAt: now,
	}
}
