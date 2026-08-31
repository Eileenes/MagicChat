package client

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"

	"app/internal/application/accountdeactivation"
	"github.com/labstack/echo/v4"
)

type AccountDeactivationService interface {
	RequestCode(context.Context, string) (accountdeactivation.Result, error)
	Deactivate(context.Context, string, string) error
}
type AccountDeactivationAPI struct{ service AccountDeactivationService }

func NewAccountDeactivationAPI(s AccountDeactivationService) *AccountDeactivationAPI {
	return &AccountDeactivationAPI{s}
}
func (a *AccountDeactivationAPI) RegisterRoutes(g *echo.Group) {
	g.POST("/me/deactivation/code", a.requestCode)
	g.POST("/me/deactivation", a.deactivate)
}

type deactivationRequest struct {
	Code string `json:"code"`
}

type deactivationCodeResponse struct {
	ExpiresInSeconds  int `json:"expires_in_seconds"`
	RetryAfterSeconds int `json:"retry_after_seconds"`
}

// requestCode godoc
// @Summary 请求账号注销验证码
// @Tags 客户端认证
// @Produce json
// @Success 200 {object} successEnvelope{data=deactivationCodeResponse}
// @Failure 409 {object} errorEnvelope
// @Failure 429 {object} errorEnvelope
// @Failure 503 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/me/deactivation/code [post]
func (a *AccountDeactivationAPI) requestCode(c echo.Context) error {
	if c.Request().ContentLength != 0 {
		return writeFailure(c, http.StatusBadRequest, string(accountdeactivation.CodeInvalidRequest), "请求不应包含参数")
	}
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, "internal_error", "服务端错误")
	}
	result, err := a.service.RequestCode(c.Request().Context(), current.ID)
	if err != nil {
		return writeDeactivationError(c, err)
	}
	return writeSuccess(c, 200, result)
}

// deactivate godoc
// @Summary 注销当前账号
// @Tags 客户端认证
// @Accept json
// @Produce json
// @Param body body deactivationRequest true "8 位数字验证码"
// @Success 200 {object} successEnvelope
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Security BearerAuth
// @Security CookieAuth
// @Router /api/client/me/deactivation [post]
func (a *AccountDeactivationAPI) deactivate(c echo.Context) error {
	var req deactivationRequest
	mediaType, _, err := mime.ParseMediaType(c.Request().Header.Get(echo.HeaderContentType))
	if err != nil || mediaType != echo.MIMEApplicationJSON {
		return writeFailure(c, 400, "invalid_request", "请求格式错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 1024)
	decoder := json.NewDecoder(c.Request().Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return writeFailure(c, 400, "invalid_request", "请求格式错误")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return writeFailure(c, 400, "invalid_request", "请求格式错误")
	}
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, "internal_error", "服务端错误")
	}
	if err := a.service.Deactivate(c.Request().Context(), current.ID, req.Code); err != nil {
		return writeDeactivationError(c, err)
	}
	credential, _ := sessionCredentialFromRequest(c.Request())
	if credential.source == "cookie" {
		clearSessionCookie(c)
	}
	return writeSuccess(c, 200, map[string]any{})
}
func writeDeactivationError(c echo.Context, err error) error {
	code := accountdeactivation.ErrorCodeOf(err)
	status := http.StatusInternalServerError
	switch code {
	case accountdeactivation.CodeInvalidRequest:
		status = 400
	case accountdeactivation.CodeInvalidCode:
		status = 401
	case accountdeactivation.CodeTooManyRequests:
		status = 429
		if retry := accountdeactivation.RetryAfterOf(err); retry > 0 {
			c.Response().Header().Set("Retry-After", strconv.Itoa(retry))
		}
	case accountdeactivation.CodeAccountNotActive, accountdeactivation.CodeEmailUnavailable:
		status = 409
	case accountdeactivation.CodeServiceUnavailable:
		status = 503
	}
	return writeFailure(c, status, string(code), err.Error())
}
