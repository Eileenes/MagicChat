package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"app/internal/appconnection"
	conversationapp "app/internal/application/conversation"
	"app/internal/realtime"
	"app/internal/store"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

func TestDecodeConversationStatusTrimsAndCountsUnicodeCodePoints(t *testing.T) {
	id := uuid.NewString()
	request, err := decodeConversationStatus(json.RawMessage(`{"conversation_id":" ` + id + ` ","status":" 处理中 🚀 "}`))
	if err != nil {
		t.Fatalf("decodeConversationStatus: %v", err)
	}
	if request.ConversationID != id || request.Status != "处理中 🚀" {
		t.Fatalf("request = %#v", request)
	}
}

func TestDecodeConversationStatusRejectsInvalidPayload(t *testing.T) {
	id := uuid.NewString()
	for _, payload := range []string{
		`{"conversation_id":"conversation-1","status":"ok"}`,
		`{"conversation_id":"` + id + `","status":"   "}`,
		`{"conversation_id":"` + id + `","status":"` + strings.Repeat("界", 33) + `"}`,
		`{"conversation_id":"` + id + `","status":"ok","sender":{"id":"forged","type":"user"}}`,
		`{"conversation_id":"` + id + `","status":"ok"} {}`,
	} {
		if _, err := decodeConversationStatus(json.RawMessage(payload)); err == nil {
			t.Errorf("payload accepted: %s", payload)
		}
	}
}

func newStatusTestServer(t *testing.T) (*Server, *gorm.DB) {
	httpServer, db := newTestRouter(t)
	httpServer.Close()
	return &Server{db: db, conversations: conversationapp.NewService(conversationapp.Dependencies{DB: db}), realtime: realtime.NewConnectionPool(realtime.Options{}), appConnections: appconnection.NewManager(appconnection.Options{})}, db
}

func statusRequest(id string, extra string) realtime.Envelope {
	payload := `{"conversation_id":"` + id + `","status":"typing"` + extra + `}`
	return realtime.Envelope{ID: uuid.NewString(), Method: methodConversationStatus, Payload: json.RawMessage(payload)}
}

func TestConversationStatusDirectUserToUserAndOffline(t *testing.T) {
	s, db := newStatusTestServer(t)
	now := time.Now().UTC()
	alice := insertTestUser(t, db, "status-direct-a@example.com", "A", store.UserStatusActive, now)
	bob := insertTestUser(t, db, "status-direct-b@example.com", "B", store.UserStatusActive, now)
	conversation := insertTestConversation(t, db, testConversationInput{createdByUserID: alice.ID, kind: store.ConversationKindDirect, memberIDs: []string{alice.ID, bob.ID}, now: now})
	bobConn := realtime.NewConnection("bob-status", bob.ID, 4, nil)
	s.realtime.Register(bobConn)
	response := s.handleRealtimeRequest(alice.ID, statusRequest(conversation.ID, ""))
	if response.OK == nil || !*response.OK {
		t.Fatalf("response = %#v", response)
	}
	select {
	case event := <-bobConn.Outgoing():
		assertStatusEvent(t, event, conversation.ID, alice.ID, "user")
	default:
		t.Fatal("SendToUser did not deliver event")
	}
	s.realtime.Unregister(bobConn)
	response = s.handleRealtimeRequest(alice.ID, statusRequest(conversation.ID, ""))
	if response.OK == nil || !*response.OK {
		t.Fatalf("offline response = %#v", response)
	}
}

func TestConversationStatusUserToAppAndAppToUser(t *testing.T) {
	s, db := newStatusTestServer(t)
	now := time.Now().UTC()
	user := insertTestUser(t, db, "status-app-user@example.com", "User", store.UserStatusActive, now)
	app := insertTestApp(t, db, store.App{Name: "Status app", Visibility: store.AppVisibilityPublic, CreatedAt: now, UpdatedAt: now})
	conversation := insertTestConversation(t, db, testConversationInput{createdByUserID: user.ID, kind: store.ConversationKindApp, memberIDs: []string{user.ID}, now: now})
	insertTestAppConversationLink(t, db, app.ID, user.ID, conversation.ID, now)
	appClient := connectStatusTestApp(t, s.appConnections, app.ID)
	defer appClient.Close()
	response := s.handleRealtimeRequest(user.ID, statusRequest(conversation.ID, ""))
	if response.OK == nil || !*response.OK {
		t.Fatalf("user-to-app response = %#v", response)
	}
	_ = appClient.SetReadDeadline(time.Now().Add(time.Second))
	var appEvent realtime.Envelope
	if err := appClient.ReadJSON(&appEvent); err != nil {
		t.Fatalf("SendToApp event: %v", err)
	}
	assertStatusEvent(t, appEvent, conversation.ID, user.ID, "user")

	userConn := realtime.NewConnection("status-user", user.ID, 4, nil)
	s.realtime.Register(userConn)
	response = s.handleAppRequest(app.ID, statusRequest(conversation.ID, ""))
	if response.OK == nil || !*response.OK {
		t.Fatalf("app-to-user response = %#v", response)
	}
	select {
	case event := <-userConn.Outgoing():
		assertStatusEvent(t, event, conversation.ID, app.ID, "app")
	default:
		t.Fatal("app-to-user SendToUser did not deliver")
	}
}

func TestConversationStatusRejectsGroupTopicAndForgedSender(t *testing.T) {
	s, db := newStatusTestServer(t)
	now := time.Now().UTC()
	a := insertTestUser(t, db, "status-invalid-a@example.com", "A", store.UserStatusActive, now)
	b := insertTestUser(t, db, "status-invalid-b@example.com", "B", store.UserStatusActive, now)
	for _, kind := range []string{store.ConversationKindGroup, store.ConversationKindTopic} {
		conversation := insertTestConversation(t, db, testConversationInput{createdByUserID: a.ID, kind: kind, memberIDs: []string{a.ID, b.ID}, now: now})
		response := s.handleRealtimeRequest(a.ID, statusRequest(conversation.ID, ""))
		if response.OK == nil || *response.OK || response.Error == nil || response.Error.Code != "invalid_conversation" {
			t.Fatalf("kind %s response = %#v", kind, response)
		}
	}
	direct := insertTestConversation(t, db, testConversationInput{createdByUserID: a.ID, kind: store.ConversationKindDirect, memberIDs: []string{a.ID, b.ID}, now: now})
	bConn := realtime.NewConnection("forged-target", b.ID, 4, nil)
	s.realtime.Register(bConn)
	response := s.handleRealtimeRequest(a.ID, statusRequest(direct.ID, `,"sender":{"id":"`+b.ID+`","type":"user"}`))
	if response.OK == nil || *response.OK || response.Error == nil || response.Error.Code != "invalid_request" {
		t.Fatalf("forged response = %#v", response)
	}
	select {
	case event := <-bConn.Outgoing():
		t.Fatalf("forged request delivered %#v", event)
	default:
	}
}

func assertStatusEvent(t *testing.T, event realtime.Envelope, conversationID, senderID, senderType string) {
	t.Helper()
	if event.Event != realtime.EventConversationStatus {
		t.Fatalf("event = %#v", event)
	}
	var payload conversationStatusEvent
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ConversationID != conversationID || payload.Status != "typing" || payload.Sender.ID != senderID || payload.Sender.Type != senderType {
		t.Fatalf("payload = %#v", payload)
	}
}

func connectStatusTestApp(t *testing.T, manager *appconnection.Manager, appID string) *websocket.Conn {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn := manager.NewConnection(appID, socket)
		manager.Register(conn)
		defer manager.Unregister(conn)
		conn.Serve()
	}))
	t.Cleanup(server.Close)
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	client, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for !manager.IsOnline(appID) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !manager.IsOnline(appID) {
		t.Fatal("app connection was not registered")
	}
	return client
}
