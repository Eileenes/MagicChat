package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"app/internal/application/account"
	conversationapp "app/internal/application/conversation"
	messageapp "app/internal/application/message"
	searchapp "app/internal/application/search"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func TestSearchAPISearchesMessagesAndReturnsConversationData(t *testing.T) {
	accountID := uuid.NewString()
	conversationID := uuid.NewString()
	senderID := uuid.NewString()
	messageID := uuid.NewString()
	from := "2026-06-01T00:00:00+08:00"
	to := "2026-07-01T00:00:00+08:00"
	stub := &searchServiceStub{result: searchapp.SearchMessagesResult{Items: []searchapp.MessageResultItem{{
		Conversation: conversationapp.SearchSummary{
			Avatar: "/group.webp", ID: conversationID, Name: "研发群", Type: "group",
		},
		Message: messageapp.Message{
			ID: messageID, ConversationID: conversationID, Summary: "发布计划已确认",
			Body:   json.RawMessage(`{"type":"text","content":"发布计划已确认"}`),
			Sender: messageapp.Identity{ID: senderID, Type: "user"}, Seq: 7,
		},
	}}}}
	api := NewSearchAPI(stub)
	e := echo.New()
	query := url.Values{
		"keyword":         {"发布计划"},
		"sender_id":       {senderID},
		"conversation_id": {conversationID},
		"from":            {from},
		"to":              {to},
	}
	req := httptest.NewRequest(
		http.MethodGet,
		"/search/messages?"+query.Encode(),
		nil,
	)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(currentAccountKey, account.Account{ID: accountID})

	if err := api.searchMessages(c); err != nil {
		t.Fatalf("search messages: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if stub.command.AccountID != accountID || stub.command.Keyword != "发布计划" || stub.command.SenderID != senderID || stub.command.ConversationID != conversationID {
		t.Fatalf("command = %#v", stub.command)
	}
	wantFrom, _ := time.Parse(time.RFC3339, from)
	wantTo, _ := time.Parse(time.RFC3339, to)
	if stub.command.From == nil || !stub.command.From.Equal(wantFrom) || stub.command.To == nil || !stub.command.To.Equal(wantTo) {
		t.Fatalf("time range = %v..%v", stub.command.From, stub.command.To)
	}
	var response struct {
		Success bool                   `json:"success"`
		Data    searchMessagesResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Success || len(response.Data.Items) != 1 {
		t.Fatalf("response = %#v", response)
	}
	item := response.Data.Items[0]
	if item.Message.ID != messageID || item.Message.Summary != "发布计划已确认" || item.Conversation.Name != "研发群" {
		t.Fatalf("item = %#v", item)
	}
}

func TestSearchAPIRejectsInvalidTime(t *testing.T) {
	stub := &searchServiceStub{}
	api := NewSearchAPI(stub)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/search/messages?keyword=message&from=yesterday", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(currentAccountKey, account.Account{ID: uuid.NewString()})

	if err := api.searchMessages(c); err != nil {
		t.Fatalf("search messages: %v", err)
	}
	if rec.Code != http.StatusBadRequest || stub.called {
		t.Fatalf("status = %d, called = %v, body = %s", rec.Code, stub.called, rec.Body.String())
	}
}

func TestSearchAPIReturnsServiceUnavailableWhenSearchTimesOut(t *testing.T) {
	stub := &searchServiceStub{err: &searchapp.Error{
		Code: searchapp.CodeTimeout, Message: "搜索超时，请缩小搜索范围后重试",
	}}
	api := NewSearchAPI(stub)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/search/messages?keyword=message", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set(currentAccountKey, account.Account{ID: uuid.NewString()})

	if err := api.searchMessages(c); err != nil {
		t.Fatalf("search messages: %v", err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

type searchServiceStub struct {
	called  bool
	command searchapp.SearchMessagesCommand
	result  searchapp.SearchMessagesResult
	err     error
}

func (s *searchServiceStub) SearchMessages(_ context.Context, command searchapp.SearchMessagesCommand) (searchapp.SearchMessagesResult, error) {
	s.called = true
	s.command = command
	return s.result, s.err
}
