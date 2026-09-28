package config

import (
	"os"
	"testing"
	"time"
)

func TestConfigLoadFromEnv(t *testing.T) {
	os.Setenv("SKYOPS_SERVER_URL", "https://skyops.example.com")
	os.Setenv("SKYOPS_CLUSTER_ID", "sky-prod-01")
	os.Setenv("SKYOPS_AGENT_TOKEN", "test-token-12345")
	os.Setenv("SKYOPS_HEARTBEAT_INTERVAL", "15s")
	os.Setenv("SKYOPS_TELEMETRY_INTERVAL", "30s")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("unexpected error loading config: %v", err)
	}

	if cfg.ServerURL != "https://skyops.example.com" {
		t.Errorf("expected server url https://skyops.example.com, got %s", cfg.ServerURL)
	}
	if cfg.ClusterID != "sky-prod-01" {
		t.Errorf("expected cluster id sky-prod-01, got %s", cfg.ClusterID)
	}
	if cfg.AgentToken != "test-token-12345" {
		t.Errorf("expected token test-token-12345, got %s", cfg.AgentToken)
	}
	if cfg.HeartbeatInterval != 15*time.Second {
		t.Errorf("expected heartbeat interval 15s, got %v", cfg.HeartbeatInterval)
	}
	if cfg.TelemetryInterval != 30*time.Second {
		t.Errorf("expected telemetry interval 30s, got %v", cfg.TelemetryInterval)
	}
}

func TestConfigValidationMissing(t *testing.T) {
	os.Unsetenv("SKYOPS_SERVER_URL")
	os.Unsetenv("SKYOPS_CLUSTER_ID")
	os.Unsetenv("SKYOPS_AGENT_TOKEN")

	_, err := LoadFromEnv()
	if err == nil {
		t.Errorf("expected error when required environment variables are missing")
	}
}
