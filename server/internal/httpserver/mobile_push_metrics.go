package httpserver

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/labstack/echo/v4"
)

func (s *Server) mobilePushMetrics(c echo.Context) error {
	metrics, err := s.mobilePush.QueueMetrics(c.Request().Context())
	if err != nil {
		return err
	}
	var output strings.Builder
	output.WriteString("# HELP magicchat_mobile_push_enabled Whether private-server remote push is enabled.\n")
	output.WriteString("# TYPE magicchat_mobile_push_enabled gauge\n")
	if metrics.Enabled {
		output.WriteString("magicchat_mobile_push_enabled 1\n")
	} else {
		output.WriteString("magicchat_mobile_push_enabled 0\n")
	}
	writePushStatusMetric(
		&output,
		"magicchat_mobile_push_events",
		"Current transactional push events by status.",
		metrics.EventCounts,
	)
	writePushStatusMetric(
		&output,
		"magicchat_mobile_push_jobs",
		"Current private-server push jobs by status.",
		metrics.JobCounts,
	)
	writePushStatusMetric(
		&output,
		"magicchat_mobile_push_grants",
		"Current private-server push grants by status.",
		metrics.GrantCounts,
	)
	output.WriteString("# HELP magicchat_mobile_push_recent_failed_events Push events that failed during the last ten minutes.\n")
	output.WriteString("# TYPE magicchat_mobile_push_recent_failed_events gauge\n")
	fmt.Fprintf(&output, "magicchat_mobile_push_recent_failed_events %d\n", metrics.RecentFailedEvents)
	writePushCodeMetric(
		&output,
		"magicchat_mobile_push_recent_failed_events_by_code",
		"Push events that failed during the last ten minutes by anonymous error code.",
		metrics.RecentFailedEventCounts,
	)
	output.WriteString("# HELP magicchat_mobile_push_recent_failed_jobs Push jobs that failed during the last ten minutes.\n")
	output.WriteString("# TYPE magicchat_mobile_push_recent_failed_jobs gauge\n")
	fmt.Fprintf(&output, "magicchat_mobile_push_recent_failed_jobs %d\n", metrics.RecentFailedJobs)
	writePushCodeMetric(
		&output,
		"magicchat_mobile_push_recent_failed_jobs_by_code",
		"Push jobs that failed during the last ten minutes by anonymous error code.",
		metrics.RecentFailedJobCounts,
	)
	output.WriteString("# HELP magicchat_mobile_push_oldest_pending_event_age_seconds Age of the oldest pending push event.\n")
	output.WriteString("# TYPE magicchat_mobile_push_oldest_pending_event_age_seconds gauge\n")
	fmt.Fprintf(&output, "magicchat_mobile_push_oldest_pending_event_age_seconds %.0f\n", metrics.OldestPendingEventAgeSeconds)
	output.WriteString("# HELP magicchat_mobile_push_oldest_pending_job_age_seconds Age of the oldest pending push job.\n")
	output.WriteString("# TYPE magicchat_mobile_push_oldest_pending_job_age_seconds gauge\n")
	fmt.Fprintf(&output, "magicchat_mobile_push_oldest_pending_job_age_seconds %.0f\n", metrics.OldestPendingJobAgeSeconds)
	return c.Blob(
		http.StatusOK,
		"text/plain; version=0.0.4; charset=utf-8",
		[]byte(output.String()),
	)
}

func writePushCodeMetric(
	output *strings.Builder,
	name string,
	help string,
	counts map[string]int64,
) {
	fmt.Fprintf(output, "# HELP %s %s\n", name, help)
	fmt.Fprintf(output, "# TYPE %s gauge\n", name)
	codes := make([]string, 0, len(counts))
	for code := range counts {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	for _, code := range codes {
		fmt.Fprintf(output, "%s{code=%q} %d\n", name, code, counts[code])
	}
}

func writePushStatusMetric(
	output *strings.Builder,
	name string,
	help string,
	counts map[string]int64,
) {
	fmt.Fprintf(output, "# HELP %s %s\n", name, help)
	fmt.Fprintf(output, "# TYPE %s gauge\n", name)
	statuses := make([]string, 0, len(counts))
	for status := range counts {
		statuses = append(statuses, status)
	}
	sort.Strings(statuses)
	for _, status := range statuses {
		fmt.Fprintf(output, "%s{status=%q} %d\n", name, status, counts[status])
	}
}
