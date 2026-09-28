package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
)

func TestTransportRegisterAndHeartbeat(t *testing.T) {
	var authHeader string
	var registeredPayload RegistrationPayload
	var heartbeatPayload HeartbeatPayload

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")

		switch r.URL.Path {
		case "/api/v1/agent/register":
			if err := json.NewDecoder(r.Body).Decode(&registeredPayload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(RegistrationResponse{
				Status:         "ONLINE",
				ClusterID:      "test-cluster-123",
				ConnectionCode: "PAIR-123",
				ServerTime:     time.Now().UnixMilli(),
			})

		case "/api/v1/agent/heartbeat":
			if err := json.NewDecoder(r.Body).Decode(&heartbeatPayload); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"ok"}`))

		case "/api/v1/agent/telemetry":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"received"}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	cfg := &config.Config{
		ServerURL:    server.URL,
		ClusterID:    "test-cluster-123",
		AgentToken:   "sec-token-xyz",
		AgentVersion: "v1.5.0",
		MaxRetries:   2,
		BackoffBase:  10 * time.Millisecond,
	}

	client := NewClient(cfg)
	ctx := context.Background()

	// 1. Test RegisterAgent
	regResp, err := client.RegisterAgent(ctx, RegistrationPayload{
		AgentVersion: "v1.5.0",
		K8sVersion:   "v1.28.2",
	})
	if err != nil {
		t.Fatalf("RegisterAgent failed: %v", err)
	}
	if regResp.Status != "ONLINE" || regResp.ConnectionCode != "PAIR-123" {
		t.Errorf("unexpected register response: %+v", regResp)
	}
	if authHeader != "Bearer sec-token-xyz" {
		t.Errorf("expected Authorization 'Bearer sec-token-xyz', got %s", authHeader)
	}

	// 2. Test SendHeartbeat
	err = client.SendHeartbeat(ctx, HeartbeatPayload{
		ClusterID:    "test-cluster-123",
		AgentVersion: "v1.5.0",
		K8sVersion:   "v1.28.2",
		NodeCount:    3,
		PodCount:     15,
		Timestamp:    time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatalf("SendHeartbeat failed: %v", err)
	}
	if heartbeatPayload.NodeCount != 3 || heartbeatPayload.PodCount != 15 {
		t.Errorf("unexpected heartbeat payload received: %+v", heartbeatPayload)
	}

	// 3. Test SendTelemetry
	err = client.SendTelemetry(ctx, map[string]interface{}{
		"clusterId": "test-cluster-123",
		"items":     []string{"sample-resource"},
	})
	if err != nil {
		t.Fatalf("SendTelemetry failed: %v", err)
	}
}
