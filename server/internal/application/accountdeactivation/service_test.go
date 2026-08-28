package accountdeactivation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"app/internal/application/emailauth"
	settingsapp "app/internal/application/settings"
	"app/internal/store"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type fakeSettings struct {
	emailLoginEnabled bool
}

func (fakeSettings) Get(context.Context) (settingsapp.Settings, error) {
	return settingsapp.Settings{AppName: "Dianbao", OrganizationName: "Org"}, nil
}
func (s fakeSettings) GetEmailLogin(context.Context) (settingsapp.EmailLoginSettings, error) {
	return settingsapp.EmailLoginSettings{Enabled: s.emailLoginEnabled}, nil
}

type fakeMailer struct {
	db        *gorm.DB
	err       error
	cancel    context.CancelFunc
	messages  []emailauth.Mail
	committed bool
}

func (m *fakeMailer) SendAccountDeactivationCode(_ context.Context, v emailauth.Mail) error {
	var n int64
	m.db.Model(&store.AccountDeactivationChallenge{}).Where("consumed_at IS NULL").Count(&n)
	m.committed = n > 0
	m.messages = append(m.messages, v)
	if m.cancel != nil {
		m.cancel()
	}
	return m.err
}

type fakePresence struct {
	mu    sync.Mutex
	calls int
}

type fakeSQLStateError struct {
	code string
}

func (e fakeSQLStateError) Error() string    { return "transaction failed" }
func (e fakeSQLStateError) SQLState() string { return e.code }

func (p *fakePresence) CloseUser(string) int { p.mu.Lock(); defer p.mu.Unlock(); p.calls++; return 1 }

func testService(t *testing.T, now *time.Time, mailErr error) (*Service, *gorm.DB, *fakeMailer, *fakePresence, store.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&store.User{}, &store.UserSession{}, &store.AccountDeactivationChallenge{}, &store.MobilePushRoute{}, &store.UserPushGrant{}, &store.MobilePushJob{}); err != nil {
		t.Fatal(err)
	}
	u := store.User{ID: uuid.NewString(), Email: "alice@example.com", Name: "Alice", PasswordHash: "hash", Status: store.UserStatusActive, CreatedAt: *now, UpdatedAt: *now}
	if err = db.Create(&u).Error; err != nil {
		t.Fatal(err)
	}
	mailer := &fakeMailer{db: db, err: mailErr}
	presence := &fakePresence{}
	s := NewService(Dependencies{DB: db, Settings: fakeSettings{emailLoginEnabled: true}, Mailer: mailer, Secret: "test-server-secret", Presence: presence, Now: func() time.Time { return *now }, GenerateCode: func() (string, error) { return "12345678", nil }})
	return s, db, mailer, presence, u
}

func TestRetryTransactionRetriesPostgresDeadlocks(t *testing.T) {
	attempts := 0
	err := retryTransaction(context.Background(), func() error {
		attempts++
		if attempts < transactionRetryAttempts {
			return fmt.Errorf("wrapped: %w", fakeSQLStateError{code: "40P01"})
		}
		return nil
	})
	if err != nil || attempts != transactionRetryAttempts {
		t.Fatalf("err=%v attempts=%d", err, attempts)
	}
}

func TestRetryTransactionDoesNotRetryOrdinaryErrors(t *testing.T) {
	attempts := 0
	expected := errors.New("ordinary failure")
	err := retryTransaction(context.Background(), func() error {
		attempts++
		return expected
	})
	if !errors.Is(err, expected) || attempts != 1 {
		t.Fatalf("err=%v attempts=%d", err, attempts)
	}
}

func TestRequestCodeCommitsBeforeSMTPAndMACIsSecret(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, mailer, _, u := testService(t, &now, nil)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	if !mailer.committed || len(mailer.messages) != 1 || mailer.messages[0].Recipient != u.Email {
		t.Fatalf("mailer=%+v", mailer)
	}
	var ch store.AccountDeactivationChallenge
	if err := db.First(&ch).Error; err != nil {
		t.Fatal(err)
	}
	plain := []byte("12345678")
	ordinary := sha256.Sum256(plain)
	if bytes.Equal(ch.CodeMAC, plain) || bytes.Equal(ch.CodeMAC, ordinary[:]) {
		t.Fatal("code MAC is plaintext or ordinary SHA-256")
	}
}

func TestRequestCodeWorksWhenEmailLoginIsDisabled(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, _, mailer, _, u := testService(t, &now, nil)
	s.settings = fakeSettings{emailLoginEnabled: false}

	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	if len(mailer.messages) != 1 || mailer.messages[0].Recipient != u.Email {
		t.Fatalf("mailer=%+v", mailer)
	}
}

func TestRequestCodeFailureInvalidatesChallengeAndKeepsCooldown(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, _, _, u := testService(t, &now, errors.New("smtp down"))
	if _, err := s.RequestCode(context.Background(), u.ID); ErrorCodeOf(err) != CodeServiceUnavailable {
		t.Fatalf("error=%v", err)
	}
	var ch store.AccountDeactivationChallenge
	db.First(&ch)
	if ch.ConsumedAt == nil {
		t.Fatal("failed delivery challenge remains usable")
	}
	if _, err := s.RequestCode(context.Background(), u.ID); ErrorCodeOf(err) != CodeTooManyRequests || RetryAfterOf(err) != 5 {
		t.Fatalf("cooldown error=%v retry=%d", err, RetryAfterOf(err))
	}
}

func TestRequestCodeInvalidatesChallengeAfterRequestCancellation(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, mailer, _, u := testService(t, &now, context.Canceled)
	ctx, cancel := context.WithCancel(context.Background())
	mailer.cancel = cancel
	if _, err := s.RequestCode(ctx, u.ID); ErrorCodeOf(err) != CodeServiceUnavailable {
		t.Fatalf("error=%v", err)
	}
	var ch store.AccountDeactivationChallenge
	if err := db.First(&ch).Error; err != nil {
		t.Fatal(err)
	}
	if ch.ConsumedAt == nil {
		t.Fatal("challenge remains usable after request context cancellation")
	}
}

func TestChallengeLifecycle(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, mailer, _, u := testService(t, &now, nil)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	now = now.Add(SendCooldown)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	var all []store.AccountDeactivationChallenge
	db.Order("created_at").Find(&all)
	if len(all) != 2 || all[0].ConsumedAt == nil {
		t.Fatalf("challenges=%+v", all)
	}
	if err := s.Deactivate(context.Background(), u.ID, "00000000"); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("old/wrong code error=%v", err)
	}
	for i := 1; i < MaxFailedAttempts; i++ {
		_ = s.Deactivate(context.Background(), u.ID, "00000000")
	}
	var latest store.AccountDeactivationChallenge
	db.Order("created_at DESC").First(&latest)
	if latest.FailedAttempts != 5 {
		t.Fatalf("attempts=%d", latest.FailedAttempts)
	}
	if err := s.Deactivate(context.Background(), u.ID, mailer.messages[1].Code); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("limit error=%v", err)
	}
	now = now.Add(SendCooldown)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	now = now.Add(CodeTTL)
	if err := s.Deactivate(context.Background(), u.ID, "12345678"); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("expiry error=%v", err)
	}
	now = now.Add(SendCooldown)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&store.User{}).Where("id = ?", u.ID).Update("email", "changed@example.com")
	if err := s.Deactivate(context.Background(), u.ID, "12345678"); ErrorCodeOf(err) != CodeInvalidCode {
		t.Fatalf("email change error=%v", err)
	}
}

func TestDeactivateSuccessAndRollback(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, _, presence, u := testService(t, &now, nil)
	if _, err := s.RequestCode(context.Background(), u.ID); err != nil {
		t.Fatal(err)
	}
	session := store.UserSession{ID: uuid.NewString(), TokenHash: "token", UserID: u.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now}
	db.Create(&session)
	db.Exec("PRAGMA foreign_keys = OFF")
	db.Create(&store.UserPushGrant{ID: uuid.NewString(), UserID: u.ID, SessionID: session.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(), SendTokenCiphertext: []byte("x"), Status: "active", ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now, LastSeenAt: now})
	db.Create(&store.MobilePushJob{ID: uuid.NewString(), GrantID: uuid.NewString(), UserID: u.ID, MessageID: uuid.NewString(), Status: "pending", NextAttemptAt: now, ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now})
	db.Create(&store.MobilePushRoute{TokenHash: []byte("route"), UserID: u.ID, ConversationID: uuid.NewString(), MessageID: uuid.NewString(), ExpiresAt: now.Add(time.Hour), CreatedAt: now})
	for _, model := range []any{&store.UserSession{}, &store.UserPushGrant{}, &store.MobilePushJob{}, &store.MobilePushRoute{}} {
		var count int64
		if err := db.Model(model).Where("user_id = ?", u.ID).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("fixture %T count=%d err=%v", model, count, err)
		}
	}
	if err := s.Deactivate(context.Background(), u.ID, "12345678"); err != nil {
		t.Fatal(err)
	}
	var got store.User
	db.First(&got, "id = ?", u.ID)
	if got.Status != store.UserStatusDisabled || presence.calls != 1 {
		t.Fatalf("status=%s presence=%d", got.Status, presence.calls)
	}
	for _, model := range []any{&store.UserSession{}, &store.UserPushGrant{}, &store.MobilePushJob{}, &store.MobilePushRoute{}} {
		var n int64
		db.Model(model).Where("user_id = ?", u.ID).Count(&n)
		if n != 0 {
			t.Fatalf("%T count=%d", model, n)
		}
	}
	db.Model(&got).Update("status", store.UserStatusActive)
	var n int64
	db.Model(&store.UserSession{}).Where("user_id = ?", u.ID).Count(&n)
	if n != 0 {
		t.Fatal("admin recovery restored old session")
	}

	// A delete failure must roll back challenge consumption and user/session changes.
	now = now.Add(time.Hour)
	s2, db2, _, _, u2 := testService(t, &now, nil)
	_, _ = s2.RequestCode(context.Background(), u2.ID)
	db2.Create(&store.UserSession{ID: uuid.NewString(), TokenHash: "rollback", UserID: u2.ID, ExpiresAt: now.Add(time.Hour), CreatedAt: now, LastSeenAt: now})
	db2.Callback().Delete().Before("gorm:delete").Register("force_session_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "user_sessions" {
			tx.AddError(errors.New("forced"))
		}
	})
	if err := s2.Deactivate(context.Background(), u2.ID, "12345678"); ErrorCodeOf(err) != CodeInternal {
		t.Fatalf("rollback error=%v", err)
	}
	db2.First(&got, "id = ?", u2.ID)
	if got.Status != store.UserStatusActive {
		t.Fatal("status did not roll back")
	}
	var ch store.AccountDeactivationChallenge
	db2.First(&ch)
	if ch.ConsumedAt != nil {
		t.Fatal("challenge did not roll back")
	}
	db2.Model(&store.UserSession{}).Where("user_id = ?", u2.ID).Count(&n)
	if n != 1 {
		t.Fatalf("sessions=%d", n)
	}
}

func TestConcurrentDeactivateOnlyOneSucceeds(t *testing.T) {
	now := time.Date(2026, 8, 28, 1, 0, 0, 0, time.UTC)
	s, db, _, _, user := testService(t, &now, nil)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// Serialize SQLite transactions to model PostgreSQL's per-user row lock
	// without introducing flaky SQLITE_BUSY failures.
	sqlDB.SetMaxOpenConns(1)
	if _, err := s.RequestCode(context.Background(), user.ID); err != nil {
		t.Fatal(err)
	}
	start, results := make(chan struct{}), make(chan error, 2)
	for range 2 {
		go func() { <-start; results <- s.Deactivate(context.Background(), user.ID, "12345678") }()
	}
	close(start)
	successes := 0
	for range 2 {
		if err := <-results; err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("successful concurrent confirmations = %d, want 1", successes)
	}
}
