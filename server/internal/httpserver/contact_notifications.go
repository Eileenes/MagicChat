package httpserver

import (
	"context"

	contactapp "app/internal/application/contact"
	"app/internal/realtime"
)

type friendEventResponse struct {
	RequestID string `json:"request_id,omitempty"`
}

func (s *Server) PublishFriendEvent(_ context.Context, event contactapp.FriendEvent) {
	s.realtime.SendToUsers(event.UserIDs, realtime.NewEvent(event.Type, friendEventResponse{RequestID: event.RequestID}))
}
