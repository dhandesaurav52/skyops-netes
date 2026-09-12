package metrics

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsRegistry(t *testing.T) {
	reg := NewRegistry()
	reg.SetInfo(map[string]string{
		"version": "v1.5.0",
		"cluster": "cls-test-1",
	})

	c := reg.Counter("skyops_agent_upload_success_total")
	c.Inc(nil)
	c.Add(5, nil)

	if val := c.Get(nil); val != 6 {
		t.Fatalf("expected counter 6, got %d", val)
	}

	g := reg.Gauge("skyops_agent_queue_depth")
	g.Set(42, nil)
	if val := g.Get(nil); val != 42 {
		t.Fatalf("expected gauge 42, got %d", val)
	}

	exported := reg.ExportPrometheus()
	if !strings.Contains(exported, "skyops_agent_upload_success_total 6") {
		t.Errorf("missing counter in export: %s", exported)
	}
	if !strings.Contains(exported, "skyops_agent_queue_depth 42") {
		t.Errorf("missing gauge in export: %s", exported)
	}
	if !strings.Contains(exported, "skyops_agent_info") {
		t.Errorf("missing info metric in export: %s", exported)
	}
}

func TestHealthAndReadinessEndpoints(t *testing.T) {
	reg := NewRegistry()
	server := NewServer(0, reg)

	// Liveness probe should always return 200
	reqHealthz := httptest.NewRequest("GET", "/healthz", nil)
	wHealthz := httptest.NewRecorder()
	server.handleHealthz(wHealthz, reqHealthz)
	if wHealthz.Code != http.StatusOK {
		t.Fatalf("expected 200 on healthz, got %d", wHealthz.Code)
	}

	// Readiness when not set ready
	reqReadyz := httptest.NewRequest("GET", "/readyz", nil)
	wReadyz := httptest.NewRecorder()
	server.handleReadyz(wReadyz, reqReadyz)
	if wReadyz.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 on unready readyz, got %d", wReadyz.Code)
	}

	// Set ready
	server.SetReady(true)
	wReadyz2 := httptest.NewRecorder()
	server.handleReadyz(wReadyz2, reqReadyz)
	if wReadyz2.Code != http.StatusOK {
		t.Fatalf("expected 200 on ready readyz, got %d", wReadyz2.Code)
	}

	// Fail a registered health check
	reg.RegisterHealthCheck("k8s_api", func() error {
		return errors.New("connection refused")
	})
	wReadyz3 := httptest.NewRecorder()
	server.handleReadyz(wReadyz3, reqReadyz)
	if wReadyz3.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when health check fails, got %d", wReadyz3.Code)
	}
}
