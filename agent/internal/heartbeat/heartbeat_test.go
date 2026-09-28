package heartbeat

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

func TestServiceStartsWithoutConnectedEvidenceAndRecovers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agent/heartbeat" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &config.Config{
		ClusterID:               "cluster-stable",
		AgentID:                 "agent-stable",
		AgentToken:              "token-stable",
		ServerURL:               server.URL,
		AgentVersion:            "v1.5.0",
		MaxRetries:              0,
		BackoffBase:             time.Millisecond,
		CircuitBreakerThreshold: 5,
		CircuitBreakerCooldown:  time.Second,
	}

	service := NewService(cfg, transport.NewClient(cfg))
	if got := service.State(); got != StateReconnecting {
		t.Fatalf("expected no-evidence state %q, got %q", StateReconnecting, got)
	}

	service.send(context.Background())
	if got := service.State(); got != StateConnected {
		t.Fatalf("expected heartbeat recovery to state %q, got %q", StateConnected, got)
	}
}

func TestServiceMarksReconnectAfterBackendFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))

	cfg := &config.Config{
		ClusterID:               "cluster-stable",
		AgentID:                 "agent-stable",
		AgentToken:              "token-stable",
		ServerURL:               server.URL,
		AgentVersion:            "v1.5.0",
		MaxRetries:              0,
		BackoffBase:             time.Millisecond,
		CircuitBreakerThreshold: 5,
		CircuitBreakerCooldown:  time.Second,
	}

	service := NewService(cfg, transport.NewClient(cfg))
	service.send(context.Background())
	server.Close()
	if got := service.State(); got != StateReconnecting {
		t.Fatalf("expected backend failure to state %q, got %q", StateReconnecting, got)
	}
}
