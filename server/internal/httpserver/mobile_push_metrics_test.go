package httpserver

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMobilePushMetricsEndpoint(t *testing.T) {
	server, _ := newTestRouter(t)
	defer server.Close()
	response, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatalf("get mobile push metrics: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read mobile push metrics: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("metrics status = %d, body = %s", response.StatusCode, body)
	}
	for _, expected := range []string{
		"magicchat_mobile_push_enabled 0",
		"# TYPE magicchat_mobile_push_events gauge",
		"magicchat_mobile_push_recent_failed_events 0",
		"# TYPE magicchat_mobile_push_recent_failed_events_by_code gauge",
		"magicchat_mobile_push_recent_failed_jobs 0",
		"# TYPE magicchat_mobile_push_recent_failed_jobs_by_code gauge",
		"magicchat_mobile_push_oldest_pending_event_age_seconds 0",
		"magicchat_mobile_push_oldest_pending_job_age_seconds 0",
	} {
		if !strings.Contains(string(body), expected) {
			t.Fatalf("metrics body does not contain %q: %s", expected, body)
		}
	}
}
