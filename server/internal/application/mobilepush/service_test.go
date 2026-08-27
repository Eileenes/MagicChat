package mobilepush

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type gatewayCall struct {
	GrantID        string
	SendToken      string
	IdempotencyKey string
	Notification   NotificationRequest
}

type fakeGateway struct {
	mu    sync.Mutex
	calls []gatewayCall
	err   error
}

func (g *fakeGateway) Send(_ context.Context, grantID, sendToken, idempotencyKey string, notification NotificationRequest) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls = append(g.calls, gatewayCall{
		GrantID: grantID, SendToken: sendToken,
		IdempotencyKey: idempotencyKey, Notification: notification,
	})
	return g.err
}

func TestGrantRegistrationTransfersInstallationAndEncryptsCapability(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	alice := insertPushUser(t, db, "alice@example.com")
	bob := insertPushUser(t, db, "bob@example.com")
	installationID := uuid.NewString()
	firstGrantID := uuid.NewString()
	first, err := service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: alice.ID, InstallationID: installationID, GatewayGrantID: firstGrantID,
		SendToken: "first-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil || first.GatewayGrantID != firstGrantID {
		t.Fatalf("first registration = %#v, err = %v", first, err)
	}
	secondGrantID := uuid.NewString()
	_, err = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: bob.ID, InstallationID: installationID, GatewayGrantID: secondGrantID,
		SendToken: "second-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "android",
		ExpiresAt: now.Add(48 * time.Hour),
	})
	if err != nil {
		t.Fatalf("second registration: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "installation_id = ?", installationID).Error; err != nil {
		t.Fatalf("load grant: %v", err)
	}
	if stored.UserID != bob.ID || stored.GatewayGrantID != secondGrantID || string(stored.SendTokenCiphertext) == "second-send-token-abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("stored grant = %#v", stored)
	}
	decrypted, err := service.cipher.Decrypt(stored.SendTokenCiphertext, []byte(stored.ID))
	if err != nil || decrypted != "second-send-token-abcdefghijklmnopqrstuvwxyz" {
		t.Fatalf("decrypted send token = %q, %v", decrypted, err)
	}
}

func TestGrantRegistrationLimitsDevicesPerUser(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "device-limit@example.com")
	for index := 0; index < maxGrantsPerUser; index++ {
		if _, err := service.RegisterGrant(t.Context(), RegisterGrantCommand{
			UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
			SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
			ExpiresAt: now.Add(time.Hour),
		}); err != nil {
			t.Fatalf("register grant %d: %v", index, err)
		}
	}
	if _, err := service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(time.Hour),
	}); failureCode(err) != "grant_limit_reached" {
		t.Fatalf("grant beyond limit error = %v", err)
	}
}

func TestMessageDeliveryCreatesRouteAndDispatches(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "recipient@example.com")
	sender := insertPushUser(t, db, "sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	messageID := uuid.NewString()
	if err := db.Create(&store.MessageRegistry{
		ID: messageID, ConversationID: conversation.ID, Seq: 1,
		SenderType: store.MessageSenderTypeUser, SenderID: &sender.ID,
		CreatedAt: now, PartitionYear: int16(now.Year()), Summary: "hello",
	}).Error; err != nil {
		t.Fatalf("create registry: %v", err)
	}
	grantID := uuid.NewString()
	_, err := service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: grantID,
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios",
		ExpiresAt: now.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("register grant: %v", err)
	}
	if err := service.EnqueueMessage(t.Context(), MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: messageID,
		SenderType: store.MessageSenderTypeUser, SenderID: sender.ID,
	}); err != nil {
		t.Fatalf("enqueue message: %v", err)
	}
	var job store.MobilePushJob
	if err := db.Preload("Grant").First(&job).Error; err != nil {
		t.Fatalf("load job: %v", err)
	}
	routeToken, err := service.cipher.Decrypt(job.RouteTokenCiphertext, []byte(job.ID))
	if err != nil {
		t.Fatalf("decrypt route token: %v", err)
	}
	route, err := service.ResolveRoute(t.Context(), user.ID, routeToken)
	if err != nil || route.ConversationID != conversation.ID || route.MessageID != messageID {
		t.Fatalf("resolve route = %#v, %v", route, err)
	}
	processed, err := service.DispatchBatch(t.Context(), 10)
	if err != nil || processed != 1 {
		t.Fatalf("dispatch = %d, %v", processed, err)
	}
	if len(gateway.calls) != 1 || gateway.calls[0].GrantID != grantID || gateway.calls[0].SendToken != "gateway-send-token-abcdefghijklmnopqrstuvwxyz" || gateway.calls[0].Notification.RouteToken != routeToken {
		t.Fatalf("gateway calls = %#v", gateway.calls)
	}
	if gateway.calls[0].Notification.Event != "message.created" || gateway.calls[0].Notification.TTLSeconds != 300 {
		t.Fatalf("notification = %#v", gateway.calls[0].Notification)
	}
	leftAt := now.Add(time.Minute)
	if err := db.Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_id = ?", conversation.ID, user.ID).
		Update("left_at", leftAt).Error; err != nil {
		t.Fatalf("leave conversation: %v", err)
	}
	if _, err := service.ResolveRoute(t.Context(), user.ID, routeToken); failureCode(err) != "route_not_found" {
		t.Fatalf("route after access revocation error = %v", err)
	}
}

func TestDispatchUsesRemainingLocalTTL(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "ttl@example.com")
	sender := insertPushUser(t, db, "ttl-sender@example.com")
	conversation := insertPushConversation(t, db, user, sender, now)
	_, _ = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	if err := service.EnqueueMessage(t.Context(), MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: sender.ID,
	}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	service.now = func() time.Time { return now.Add(4*time.Minute + 500*time.Millisecond) }
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(gateway.calls) != 1 || gateway.calls[0].Notification.TTLSeconds != 60 {
		t.Fatalf("gateway calls = %#v", gateway.calls)
	}
}

func TestMessageDeliverySkipsMutedAndSelfMessages(t *testing.T) {
	service, db, _, now := newPushTestService(t)
	user := insertPushUser(t, db, "self@example.com")
	_, _ = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	for _, delivery := range []MessageDelivery{
		{UserID: user.ID, ConversationID: uuid.NewString(), MessageID: uuid.NewString(), Muted: true},
		{UserID: user.ID, ConversationID: uuid.NewString(), MessageID: uuid.NewString(), SenderType: store.MessageSenderTypeUser, SenderID: user.ID},
	} {
		if err := service.EnqueueMessage(t.Context(), delivery); err != nil {
			t.Fatalf("enqueue skipped delivery: %v", err)
		}
	}
	var count int64
	_ = db.Model(&store.MobilePushJob{}).Count(&count).Error
	if count != 0 {
		t.Fatalf("push job count = %d", count)
	}
}

func TestReclaimedJobRejectsStaleWorker(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "lease@example.com")
	other := insertPushUser(t, db, "lease-other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	_, _ = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	_ = service.EnqueueMessage(t.Context(), MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	})
	first, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(first) != 1 {
		t.Fatalf("first claim = %#v, %v", first, err)
	}
	service.now = func() time.Time { return now.Add(workerLease + time.Second) }
	second, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(second) != 1 || first[0].LockToken == second[0].LockToken {
		t.Fatalf("second claim = %#v, %v", second, err)
	}
	if err := service.dispatchJob(t.Context(), first[0]); err != nil {
		t.Fatalf("stale dispatch: %v", err)
	}
	if len(gateway.calls) != 0 {
		t.Fatal("stale worker called gateway")
	}
	if err := service.dispatchJob(t.Context(), second[0]); err != nil {
		t.Fatalf("current dispatch: %v", err)
	}
	if len(gateway.calls) != 1 {
		t.Fatalf("gateway calls = %d", len(gateway.calls))
	}
}

func TestStaleRevocationDoesNotDisableRotatedGrant(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "rotated@example.com")
	other := insertPushUser(t, db, "rotated-other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	installationID := uuid.NewString()
	oldGatewayGrantID := uuid.NewString()
	_, _ = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: oldGatewayGrantID,
		SendToken: "old-gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	_ = service.EnqueueMessage(t.Context(), MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: uuid.NewString(),
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	})
	claimed, err := service.claimJobs(t.Context(), 1)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim = %#v, %v", claimed, err)
	}
	newGatewayGrantID := uuid.NewString()
	_, err = service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: installationID, GatewayGrantID: newGatewayGrantID,
		SendToken: "new-gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "ios", ExpiresAt: now.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("rotate grant: %v", err)
	}
	gateway.err = &GatewayError{Kind: GatewayErrorRevoked, Code: "grant_revoked", StatusCode: 410}
	if err := service.dispatchJob(t.Context(), claimed[0]); err != nil {
		t.Fatalf("dispatch stale grant: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored, "installation_id = ?", installationID).Error; err != nil {
		t.Fatalf("load rotated grant: %v", err)
	}
	if stored.Status != GrantStatusActive || stored.GatewayGrantID != newGatewayGrantID {
		t.Fatalf("rotated grant = %#v", stored)
	}
}

func TestRevokedGatewayResponseDisablesLocalGrant(t *testing.T) {
	service, db, gateway, now := newPushTestService(t)
	user := insertPushUser(t, db, "revoked@example.com")
	other := insertPushUser(t, db, "other@example.com")
	conversation := insertPushConversation(t, db, user, other, now)
	messageID := uuid.NewString()
	grant, _ := service.RegisterGrant(t.Context(), RegisterGrantCommand{
		UserID: user.ID, InstallationID: uuid.NewString(), GatewayGrantID: uuid.NewString(),
		SendToken: "gateway-send-token-abcdefghijklmnopqrstuvwxyz", Platform: "android", ExpiresAt: now.Add(time.Hour),
	})
	_ = grant
	gateway.err = &GatewayError{Kind: GatewayErrorRevoked, Code: "grant_revoked", StatusCode: 410}
	if err := service.EnqueueMessage(t.Context(), MessageDelivery{
		UserID: user.ID, ConversationID: conversation.ID, MessageID: messageID,
		SenderType: store.MessageSenderTypeUser, SenderID: other.ID,
	}); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if _, err := service.DispatchBatch(t.Context(), 1); err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	var stored store.UserPushGrant
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("load grant: %v", err)
	}
	if stored.Status != GrantStatusDisabled {
		t.Fatalf("grant status = %q", stored.Status)
	}
}

func newPushTestService(t *testing.T) (*Service, *gorm.DB, *fakeGateway, time.Time) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&store.User{}, &store.Conversation{}, &store.ConversationMember{},
		&store.MessageRegistry{}, &store.ConversationTopic{}, &store.ConversationTopicParticipant{},
		&store.UserPushGrant{}, &store.MobilePushRoute{}, &store.MobilePushJob{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	cipher, err := NewTokenCipher(make([]byte, 32))
	if err != nil {
		t.Fatalf("create cipher: %v", err)
	}
	now := time.Date(2026, 8, 21, 9, 0, 0, 0, time.UTC)
	gateway := &fakeGateway{}
	service, err := NewService(Dependencies{
		DB: db, Cipher: cipher, Gateway: gateway, Enabled: true, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("create service: %v", err)
	}
	return service, db, gateway, now
}

func insertPushUser(t *testing.T, db *gorm.DB, email string) store.User {
	t.Helper()
	user := store.User{
		ID: uuid.NewString(), Email: email, Name: email,
		PasswordHash: "hash", Status: store.UserStatusActive,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}

func insertPushConversation(t *testing.T, db *gorm.DB, first, second store.User, now time.Time) store.Conversation {
	t.Helper()
	conversation := store.Conversation{
		ID: uuid.NewString(), Kind: store.ConversationKindDirect, Name: "Direct",
		CreatedByUserID: first.ID, Status: store.ConversationStatusActive,
		PostingPolicy: store.ConversationPostingPolicyOpen,
		Visibility:    store.ConversationVisibilityPrivate, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&conversation).Error; err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	for _, user := range []store.User{first, second} {
		member := store.ConversationMember{
			ConversationID: conversation.ID, MemberType: store.ConversationMemberTypeUser,
			MemberID: user.ID, Role: store.ConversationMemberRoleMember,
			JoinedAt: now, HistoryVisibleFromSeq: 1,
		}
		if err := db.Create(&member).Error; err != nil {
			t.Fatalf("create member: %v", err)
		}
	}
	return conversation
}

func failureCode(err error) string {
	if err == nil {
		return ""
	}
	var value *Error
	if errors.As(err, &value) {
		return value.Code
	}
	return "unknown"
}
