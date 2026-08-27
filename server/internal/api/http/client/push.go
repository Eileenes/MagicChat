package client

import (
	"net/http"
	"time"

	"app/internal/application/mobilepush"

	"github.com/labstack/echo/v4"
)

type PushAPI struct {
	push mobilepush.ClientService
}

type registerPushGrantRequest struct {
	InstallationID string    `json:"installation_id"`
	GrantID        string    `json:"grant_id"`
	SendToken      string    `json:"send_token"`
	Platform       string    `json:"platform"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type pushGrantResponse struct {
	InstallationID string    `json:"installation_id"`
	GrantID        string    `json:"grant_id"`
	Platform       string    `json:"platform"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type pushRouteResponse struct {
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
}

func NewPushAPI(push mobilepush.ClientService) *PushAPI {
	return &PushAPI{push: push}
}

func (a *PushAPI) RegisterRoutes(group *echo.Group) {
	group.PUT("/push/grants", a.registerGrant)
	group.DELETE("/push/grants/:installation_id", a.revokeGrant)
	group.GET("/push/routes/:route_token", a.resolveRoute)
}

// registerGrant godoc
//
// @Summary 注册当前手机的公共推送授权
// @Tags 客户端推送
// @Accept json
// @Produce json
// @Param request body registerPushGrantRequest true "推送授权"
// @Success 200 {object} successEnvelope{data=pushGrantResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 429 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Router /api/client/push/grants [put]
func (a *PushAPI) registerGrant(c echo.Context) error {
	current, ok := CurrentAccount(c)
	currentSession, sessionOK := CurrentAccountSession(c)
	if !ok || !sessionOK {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	var request registerPushGrantRequest
	if err := decodeStrictJSON(c, &request); err != nil {
		return writeFailure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	grant, err := a.push.RegisterGrant(c.Request().Context(), mobilepush.RegisterGrantCommand{
		UserID: current.ID, SessionID: currentSession.ID, InstallationID: request.InstallationID,
		GatewayGrantID: request.GrantID, SendToken: request.SendToken,
		Platform: request.Platform, ExpiresAt: request.ExpiresAt,
	})
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushGrantResponse{
		InstallationID: grant.InstallationID, GrantID: grant.GatewayGrantID,
		Platform: grant.Platform, ExpiresAt: grant.ExpiresAt,
	})
}

// revokeGrant godoc
//
// @Summary 删除当前手机的本地推送授权
// @Tags 客户端推送
// @Param installation_id path string true "安装实例 ID"
// @Success 204
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Router /api/client/push/grants/{installation_id} [delete]
func (a *PushAPI) revokeGrant(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	if err := a.push.RevokeGrant(c.Request().Context(), current.ID, c.Param("installation_id")); err != nil {
		return writePushError(c, err)
	}
	return c.NoContent(http.StatusNoContent)
}

// resolveRoute godoc
//
// @Summary 解析通知点击路由
// @Tags 客户端推送
// @Param route_token path string true "匿名路由 Token"
// @Success 200 {object} successEnvelope{data=pushRouteResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Router /api/client/push/routes/{route_token} [get]
func (a *PushAPI) resolveRoute(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusUnauthorized, "unauthorized", "未登录")
	}
	route, err := a.push.ResolveRoute(c.Request().Context(), current.ID, c.Param("route_token"))
	if err != nil {
		return writePushError(c, err)
	}
	return writeSuccess(c, http.StatusOK, pushRouteResponse{
		ConversationID: route.ConversationID, MessageID: route.MessageID,
	})
}

func writePushError(c echo.Context, err error) error {
	code := mobilepush.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case "unauthorized":
		status = http.StatusUnauthorized
	case "invalid_request":
		status = http.StatusBadRequest
	case "route_not_found":
		status = http.StatusNotFound
	case "grant_conflict":
		status = http.StatusConflict
	case "grant_limit_reached":
		status = http.StatusTooManyRequests
	case "push_disabled":
		status = http.StatusServiceUnavailable
	}
	return writeFailure(c, status, code, mobilepush.ErrorMessage(err))
}
