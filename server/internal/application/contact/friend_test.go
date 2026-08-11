package contact

import (
	"context"
	"testing"
	"time"

	"app/internal/store"
)

func TestServiceFriendLifecycleAndFriendsDirectory(t *testing.T) {
	db := openContactTestDB(t)
	if err := db.AutoMigrate(&store.UserFriendship{}, &store.UserFriendRequest{}); err != nil {
		t.Fatalf("migrate friend tables: %v", err)
	}
	now := time.Date(2026, 8, 11, 8, 0, 0, 0, time.UTC)
	alice := insertContactTestUser(t, db, "alice-friend@example.com", "Alice", store.UserStatusActive, now)
	bob := insertContactTestUser(t, db, "bob-friend@example.com", "Bob", store.UserStatusActive, now)
	carol := insertContactTestUser(t, db, "carol-friend@example.com", "Carol", store.UserStatusActive, now)
	notifications := &friendNotificationRecorder{}
	service := NewService(Dependencies{
		DB: db, Now: func() time.Time { return now },
		Settings: fixedDirectorySettings{mode: DirectoryModeFriends}, Notifications: notifications,
	})

	request, err := service.CreateFriendRequest(context.Background(), CreateFriendRequestCommand{AccountID: alice.ID, UserID: bob.ID})
	if err != nil || request.Status != store.FriendRequestStatusPending {
		t.Fatalf("create request = %#v, error = %v", request, err)
	}
	incoming, err := service.ListFriendRequests(context.Background(), ListFriendRequestsCommand{AccountID: bob.ID, Direction: FriendRequestDirectionIncoming})
	if err != nil || len(incoming.Requests) != 1 || incoming.Requests[0].ID != request.ID {
		t.Fatalf("incoming requests = %#v, error = %v", incoming, err)
	}

	accepted, err := service.AcceptFriendRequest(context.Background(), UpdateFriendRequestCommand{AccountID: bob.ID, RequestID: request.ID})
	if err != nil || accepted.Status != store.FriendRequestStatusAccepted {
		t.Fatalf("accept request = %#v, error = %v", accepted, err)
	}
	directoryMode, _, err := service.directoryUserScope(context.Background(), alice.ID)
	if err != nil || directoryMode != DirectoryModeFriends {
		t.Fatalf("directory mode = %q, error = %v", directoryMode, err)
	}
	directory, err := service.ListUsers(context.Background(), ListUsersCommand{AccountID: alice.ID})
	if err != nil || len(directory.Users) != 2 ||
		directory.Users[0].ID != alice.ID || directory.Users[1].ID != bob.ID {
		t.Fatalf("friends directory = %#v, error = %v", directory, err)
	}

	search, err := service.SearchUsers(context.Background(), SearchUsersCommand{AccountID: alice.ID, Query: carol.Email})
	if err != nil || len(search.UserIDs) != 1 || search.UserIDs[0] != carol.ID {
		t.Fatalf("exact search = %#v, error = %v", search, err)
	}
	resolved, err := service.ResolveUsers(context.Background(), ResolveUsersCommand{UserIDs: []string{carol.ID}})
	if err != nil || len(resolved.Users) != 1 || resolved.Users[0].ID != carol.ID {
		t.Fatalf("resolve non-friend = %#v, error = %v", resolved, err)
	}

	if err := service.DeleteFriend(context.Background(), DeleteFriendCommand{AccountID: alice.ID, UserID: bob.ID}); err != nil {
		t.Fatalf("delete friend: %v", err)
	}
	directory, err = service.ListUsers(context.Background(), ListUsersCommand{AccountID: alice.ID})
	if err != nil || len(directory.Users) != 1 || directory.Users[0].ID != alice.ID {
		t.Fatalf("directory after delete = %#v, error = %v", directory, err)
	}
	if len(notifications.events) != 3 || notifications.events[0].Type != "friend.request.created" ||
		notifications.events[1].Type != "friendship.created" || notifications.events[2].Type != "friendship.deleted" {
		t.Fatalf("friend events = %#v", notifications.events)
	}
}

func TestServiceCrossedFriendRequestAcceptsExistingRequest(t *testing.T) {
	db := openContactTestDB(t)
	if err := db.AutoMigrate(&store.UserFriendship{}, &store.UserFriendRequest{}); err != nil {
		t.Fatalf("migrate friend tables: %v", err)
	}
	now := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	alice := insertContactTestUser(t, db, "alice-cross@example.com", "Alice", store.UserStatusActive, now)
	bob := insertContactTestUser(t, db, "bob-cross@example.com", "Bob", store.UserStatusActive, now)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})

	request, err := service.CreateFriendRequest(context.Background(), CreateFriendRequestCommand{AccountID: alice.ID, UserID: bob.ID})
	if err != nil {
		t.Fatalf("create first request: %v", err)
	}
	accepted, err := service.CreateFriendRequest(context.Background(), CreateFriendRequestCommand{AccountID: bob.ID, UserID: alice.ID})
	if err != nil || accepted.ID != request.ID || accepted.Status != store.FriendRequestStatusAccepted {
		t.Fatalf("crossed request = %#v, error = %v", accepted, err)
	}
}

type fixedDirectorySettings struct{ mode string }

func (s fixedDirectorySettings) ContactDirectoryMode(context.Context) (string, error) {
	return s.mode, nil
}

type friendNotificationRecorder struct{ events []FriendEvent }

func (r *friendNotificationRecorder) PublishFriendEvent(_ context.Context, event FriendEvent) {
	r.events = append(r.events, event)
}
