package client

import (
	"net/http"
	"strings"
	"time"

	messageapp "app/internal/application/message"
	searchapp "app/internal/application/search"

	"github.com/labstack/echo/v4"
)

type SearchAPI struct {
	search searchapp.ClientService
}

type messageSearchConversationResponse struct {
	Avatar string `json:"avatar"`
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

type messageSearchMessageResponse struct {
	messageResponse
	SenderName string `json:"sender_name"`
	Summary    string `json:"summary"`
}

type messageSearchItemResponse struct {
	Conversation messageSearchConversationResponse `json:"conversation"`
	Message      messageSearchMessageResponse      `json:"message"`
}

type searchMessagesResponse struct {
	Items []messageSearchItemResponse `json:"items"`
}

func NewSearchAPI(search searchapp.ClientService) *SearchAPI {
	return &SearchAPI{search: search}
}

func (a *SearchAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/search/messages", a.searchMessages)
}

// searchMessages godoc
//
// @Summary 搜索聊天记录
// @Description 在滚动最近一年内搜索当前用户有权查看的聊天记录。keyword 必填，其他过滤条件可选，按消息时间倒序最多返回 10 条。
// @Tags 客户端搜索
// @Produce json
// @Param keyword query string true "消息关键词，至少 2 个字符"
// @Param sender_id query string false "发送者 ID"
// @Param conversation_id query string false "会话 ID"
// @Param from query string false "开始时间，RFC3339，必须在最近一年内"
// @Param to query string false "结束时间，RFC3339，必须在最近一年内"
// @Success 200 {object} successEnvelope{data=searchMessagesResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Router /api/client/search/messages [get]
func (a *SearchAPI) searchMessages(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(searchapp.CodeInternal), "服务端错误")
	}
	from, err := parseOptionalSearchTime(c.QueryParam("from"), "from")
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(searchapp.CodeInvalidRequest), err.Error())
	}
	to, err := parseOptionalSearchTime(c.QueryParam("to"), "to")
	if err != nil {
		return writeFailure(c, http.StatusBadRequest, string(searchapp.CodeInvalidRequest), err.Error())
	}
	result, err := a.search.SearchMessages(c.Request().Context(), searchapp.SearchMessagesCommand{
		AccountID: current.ID, ConversationID: c.QueryParam("conversation_id"), From: from,
		Keyword: c.QueryParam("keyword"), SenderID: c.QueryParam("sender_id"), To: to,
	})
	if err != nil {
		return writeSearchError(c, err)
	}
	items := make([]messageSearchItemResponse, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, messageSearchItemResponse{
			Conversation: messageSearchConversationResponse{
				Avatar: item.Conversation.Avatar, ID: item.Conversation.ID,
				Name: item.Conversation.Name, Type: item.Conversation.Type,
			},
			Message: messageSearchMessageResponse{
				messageResponse: newClientMessageResponse(item.Message),
				SenderName:      searchMessageSenderName(item.Message), Summary: item.Message.Summary,
			},
		})
	}
	return writeSuccess(c, http.StatusOK, searchMessagesResponse{Items: items})
}

func searchMessageSenderName(message messageapp.Message) string {
	if nickname := strings.TrimSpace(message.Sender.Nickname); nickname != "" {
		return nickname
	}
	if name := strings.TrimSpace(message.Sender.Name); name != "" {
		return name
	}
	if message.Sender.Type == "app" {
		return "应用"
	}
	return "用户"
}

func parseOptionalSearchTime(raw string, field string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return nil, &searchTimeError{field: field}
	}
	value = value.UTC()
	return &value, nil
}

type searchTimeError struct {
	field string
}

func (e *searchTimeError) Error() string {
	return e.field + " 必须是 RFC3339 时间"
}

func writeSearchError(c echo.Context, err error) error {
	code := searchapp.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case searchapp.CodeInvalidRequest:
		status = http.StatusBadRequest
	case searchapp.CodeTimeout:
		status = http.StatusServiceUnavailable
	}
	return writeFailure(c, status, string(code), searchapp.ErrorMessage(err))
}
