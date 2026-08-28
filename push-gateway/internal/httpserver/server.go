package httpserver

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"push-gateway/internal/gateway"
	"push-gateway/internal/model"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"gorm.io/gorm"
)

//go:embed openapi.json
var assets embed.FS

type Options struct {
	TrustedProxyCIDRs []string
}

type Server struct {
	db             *gorm.DB
	gateway        *gateway.Service
	trustedProxies []*net.IPNet
}

func New(db *gorm.DB, service *gateway.Service, options ...Options) *echo.Echo {
	server := &Server{db: db, gateway: service}
	if len(options) > 0 {
		for _, cidr := range options[0].TrustedProxyCIDRs {
			_, network, err := net.ParseCIDR(cidr)
			if err == nil {
				server.trustedProxies = append(server.trustedProxies, network)
			}
		}
	}
	router := echo.New()
	router.HideBanner = true
	router.HTTPErrorHandler = server.handleHTTPError
	router.Use(middleware.Recover())
	router.Use(middleware.BodyLimit("16K"))

	router.GET("/api/health/live", server.live)
	router.GET("/api/health/ready", server.ready)
	router.GET("/api/metrics", server.metrics)
	router.GET("/api/openapi.json", server.openAPI)

	v1 := router.Group("/api/v1")
	v1.Use(noStore)
	v1.POST("/installations", server.registerInstallation)
	v1.PUT("/installations/:installation_id/provider-token", server.updateProviderToken)
	v1.POST("/installations/:installation_id/active-grant", server.createActiveGrant)
	v1.POST("/grants/:grant_id/renew", server.renewGrant)
	v1.DELETE("/grants/:grant_id", server.revokeGrant)
	v1.POST("/grants/:grant_id/notifications", server.enqueueNotification)
	return router
}

type registerInstallationRequest struct {
	Provider      string `json:"provider"`
	ProviderToken string `json:"provider_token"`
	Platform      string `json:"platform"`
	Environment   string `json:"environment"`
	AppVersion    string `json:"app_version"`
}

func (s *Server) registerInstallation(c echo.Context) error {
	var request registerInstallationRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	credential, err := s.gateway.RegisterInstallation(c.Request().Context(), gateway.RegisterInstallationInput{
		ClientKey: s.clientAddress(c.Request()), Provider: request.Provider, ProviderToken: request.ProviderToken,
		Platform: request.Platform, Environment: request.Environment, AppVersion: request.AppVersion,
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, credential)
}

type updateProviderTokenRequest struct {
	ProviderToken string `json:"provider_token"`
	AppVersion    string `json:"app_version"`
}

func (s *Server) updateProviderToken(c echo.Context) error {
	var request updateProviderTokenRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	if err := s.gateway.UpdateProviderToken(
		c.Request().Context(), c.Param("installation_id"), installationToken(c),
		request.ProviderToken, request.AppVersion,
	); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) createActiveGrant(c echo.Context) error {
	credential, err := s.gateway.CreateActiveGrant(
		c.Request().Context(), c.Param("installation_id"), installationToken(c),
	)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, credential)
}

func (s *Server) renewGrant(c echo.Context) error {
	expiresAt, err := s.gateway.RenewGrant(c.Request().Context(), c.Param("grant_id"), installationToken(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, map[string]any{"grant_id": c.Param("grant_id"), "expires_at": expiresAt})
}

func (s *Server) revokeGrant(c echo.Context) error {
	if err := s.gateway.RevokeGrant(c.Request().Context(), c.Param("grant_id"), installationToken(c)); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

type enqueueNotificationRequest struct {
	Event       string `json:"event"`
	RouteToken  string `json:"route_token"`
	CollapseKey string `json:"collapse_key"`
	TTLSeconds  int    `json:"ttl_seconds"`
}

func (s *Server) enqueueNotification(c echo.Context) error {
	var request enqueueNotificationRequest
	if err := decodeJSON(c, &request); err != nil {
		return err
	}
	result, err := s.gateway.EnqueueNotification(c.Request().Context(), c.Param("grant_id"), bearerToken(c), gateway.NotificationInput{
		Event: request.Event, RouteToken: request.RouteToken,
		CollapseKey: request.CollapseKey, TTLSeconds: request.TTLSeconds,
		IdempotencyKey: c.Request().Header.Get("Idempotency-Key"),
	})
	if err != nil {
		return err
	}
	return c.JSON(http.StatusAccepted, result)
}

func (*Server) live(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) ready(c echo.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil || sqlDB.PingContext(c.Request().Context()) != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) metrics(c echo.Context) error {
	ctx := c.Request().Context()
	jobCounts, err := metricStatusCounts(s.db.WithContext(ctx).Model(&model.Job{}))
	if err != nil {
		return err
	}
	grantCounts, err := metricStatusCounts(s.db.WithContext(ctx).Model(&model.Grant{}))
	if err != nil {
		return err
	}
	installationCounts, err := metricInstallationCounts(s.db.WithContext(ctx))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	recentFailedQuery := s.db.WithContext(ctx).Model(&model.Job{}).
		Where("status = ? AND updated_at >= ?", model.JobStatusFailed, now.Add(-10*time.Minute))
	var recentFailedJobs int64
	if err := recentFailedQuery.Count(&recentFailedJobs).Error; err != nil {
		return err
	}
	recentFailedJobCounts, err := metricErrorCodeCounts(recentFailedQuery)
	if err != nil {
		return err
	}
	oldestJobAge, err := metricOldestAge(
		s.db.WithContext(ctx).Model(&model.Job{}).Where(
			"status IN ?", []string{model.JobStatusQueued, model.JobStatusRetry, model.JobStatusSending},
		),
		now,
	)
	if err != nil {
		return err
	}
	var output strings.Builder
	writeMetricStatusCounts(&output, "push_gateway_jobs", "Current push jobs by status.", jobCounts)
	writeMetricStatusCounts(&output, "push_gateway_grants", "Current anonymous push grants by status.", grantCounts)
	output.WriteString("# HELP push_gateway_installations Current anonymous push installations by provider, platform, and status.\n")
	output.WriteString("# TYPE push_gateway_installations gauge\n")
	for _, count := range installationCounts {
		fmt.Fprintf(
			&output,
			"push_gateway_installations{provider=%q,platform=%q,status=%q} %d\n",
			count.Provider, count.Platform, count.Status, count.Count,
		)
	}
	output.WriteString("# HELP push_gateway_recent_failed_jobs Gateway push jobs that failed during the last ten minutes.\n")
	output.WriteString("# TYPE push_gateway_recent_failed_jobs gauge\n")
	fmt.Fprintf(&output, "push_gateway_recent_failed_jobs %d\n", recentFailedJobs)
	writeMetricErrorCodeCounts(
		&output,
		"push_gateway_recent_failed_jobs_by_code",
		"Gateway push jobs that failed during the last ten minutes by anonymous error code.",
		recentFailedJobCounts,
	)
	output.WriteString("# HELP push_gateway_oldest_pending_job_age_seconds Age of the oldest pending Gateway push job.\n")
	output.WriteString("# TYPE push_gateway_oldest_pending_job_age_seconds gauge\n")
	fmt.Fprintf(&output, "push_gateway_oldest_pending_job_age_seconds %.0f\n", oldestJobAge)
	return c.Blob(http.StatusOK, "text/plain; version=0.0.4; charset=utf-8", []byte(output.String()))
}

type metricStatusCount struct {
	Status string
	Count  int64
}

type metricInstallationCount struct {
	Provider string
	Platform string
	Status   string
	Count    int64
}

type metricErrorCodeCount struct {
	Code  string
	Count int64
}

func metricStatusCounts(query *gorm.DB) ([]metricStatusCount, error) {
	var counts []metricStatusCount
	err := query.Select("status, count(*) AS count").Group("status").Scan(&counts).Error
	sort.Slice(counts, func(first, second int) bool {
		return counts[first].Status < counts[second].Status
	})
	return counts, err
}

func metricErrorCodeCounts(db *gorm.DB) ([]metricErrorCodeCount, error) {
	var counts []metricErrorCodeCount
	err := db.Select("last_error_code AS code, count(*) AS count").
		Group("last_error_code").Order("last_error_code ASC").Scan(&counts).Error
	return counts, err
}

func metricInstallationCounts(db *gorm.DB) ([]metricInstallationCount, error) {
	var counts []metricInstallationCount
	err := db.Model(&model.Installation{}).
		Select("provider, platform, status, count(*) AS count").
		Group("provider, platform, status").Scan(&counts).Error
	sort.Slice(counts, func(first, second int) bool {
		left := counts[first].Provider + "\x00" + counts[first].Platform + "\x00" + counts[first].Status
		right := counts[second].Provider + "\x00" + counts[second].Platform + "\x00" + counts[second].Status
		return left < right
	})
	return counts, err
}

func metricOldestAge(query *gorm.DB, now time.Time) (float64, error) {
	var oldest struct {
		CreatedAt time.Time
	}
	result := query.Select("created_at").Order("created_at ASC").Limit(1).Scan(&oldest)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 || !oldest.CreatedAt.Before(now) {
		return 0, nil
	}
	return now.Sub(oldest.CreatedAt).Seconds(), nil
}

func writeMetricErrorCodeCounts(
	output *strings.Builder,
	name string,
	help string,
	counts []metricErrorCodeCount,
) {
	fmt.Fprintf(output, "# HELP %s %s\n", name, help)
	fmt.Fprintf(output, "# TYPE %s gauge\n", name)
	for _, count := range counts {
		if count.Code != "" {
			fmt.Fprintf(output, "%s{code=%q} %d\n", name, count.Code, count.Count)
		}
	}
}

func writeMetricStatusCounts(
	output *strings.Builder,
	name string,
	help string,
	counts []metricStatusCount,
) {
	fmt.Fprintf(output, "# HELP %s %s\n", name, help)
	fmt.Fprintf(output, "# TYPE %s gauge\n", name)
	for _, count := range counts {
		fmt.Fprintf(output, "%s{status=%q} %d\n", name, count.Status, count.Count)
	}
}

func (*Server) openAPI(c echo.Context) error {
	content, err := assets.ReadFile("openapi.json")
	if err != nil {
		return err
	}
	return c.Blob(http.StatusOK, "application/json; charset=utf-8", content)
}

func noStore(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-store")
		c.Response().Header().Set("Pragma", "no-cache")
		return next(c)
	}
}

func decodeJSON(c echo.Context, target any) error {
	decoder := json.NewDecoder(c.Request().Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return gatewayInvalidRequest()
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return gatewayInvalidRequest()
	}
	return nil
}

func gatewayInvalidRequest() error {
	return &gateway.Failure{Code: "invalid_request", Message: "请求格式错误"}
}

func (s *Server) clientAddress(request *http.Request) string {
	peer := strings.TrimSpace(request.RemoteAddr)
	if host, _, err := net.SplitHostPort(peer); err == nil {
		peer = host
	}
	peerIP := net.ParseIP(peer)
	trusted := false
	for _, network := range s.trustedProxies {
		if peerIP != nil && network.Contains(peerIP) {
			trusted = true
			break
		}
	}
	if trusted {
		for _, candidate := range strings.Split(request.Header.Get("X-Forwarded-For"), ",") {
			if parsed := net.ParseIP(strings.TrimSpace(candidate)); parsed != nil {
				return parsed.String()
			}
		}
		if parsed := net.ParseIP(strings.TrimSpace(request.Header.Get("X-Real-IP"))); parsed != nil {
			return parsed.String()
		}
	}
	if peerIP != nil {
		return peerIP.String()
	}
	return peer
}

func installationToken(c echo.Context) string {
	return authToken(c.Request().Header.Get("Authorization"), "Installation")
}

func bearerToken(c echo.Context) string {
	return authToken(c.Request().Header.Get("Authorization"), "Bearer")
}

func authToken(header, scheme string) string {
	parts := strings.Fields(strings.TrimSpace(header))
	if len(parts) != 2 || !strings.EqualFold(parts[0], scheme) {
		return ""
	}
	return parts[1]
}

func (s *Server) handleHTTPError(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	status := http.StatusInternalServerError
	code := "internal_error"
	message := "服务端错误"
	if failure, ok := gateway.FailureOf(err); ok {
		code, message = failure.Code, failure.Message
		switch code {
		case "unauthorized":
			status = http.StatusUnauthorized
		case "installation_not_found", "grant_not_found":
			status = http.StatusNotFound
		case "grant_revoked", "grant_expired", "installation_disabled":
			status = http.StatusGone
		case "rate_limited":
			status = http.StatusTooManyRequests
		default:
			status = http.StatusBadRequest
		}
	} else {
		var echoErr *echo.HTTPError
		if errors.As(err, &echoErr) {
			status = echoErr.Code
			code = "http_error"
			message = http.StatusText(status)
		}
		c.Logger().Error(err)
	}
	_ = c.JSON(status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
