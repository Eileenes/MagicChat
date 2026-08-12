package httpserver

import (
	"context"

	"app/internal/realtime"
)

const contactDirectoryModeUpdatedEvent = "contact.directory.mode.updated"

type contactDirectoryModeUpdatedEventResponse struct {
	Mode string `json:"mode"`
}

func (s *Server) PublishContactDirectoryModeUpdated(_ context.Context, mode string) {
	s.realtime.Broadcast(realtime.NewEvent(contactDirectoryModeUpdatedEvent, contactDirectoryModeUpdatedEventResponse{Mode: mode}))
}
