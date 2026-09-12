package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration for the SkyOps Kubernetes Agent
type Config struct {
	ClusterID                string
	AgentID                  string
	AgentToken               string
	ServerURL                string
	AgentVersion             string
	NodeName                 string
	PodNamespace             string
	PodName                  string
	HeartbeatInterval        time.Duration
	TelemetryInterval        time.Duration
	QueueCapacity            int
	MaxRetries               int
	BackoffBase              time.Duration
	ActionPollInterval       time.Duration
	MetricsPort              int
	EnableMetrics            bool
	SpoolDir                 string
	SpoolMaxBytes            int64
	EnableSpool              bool
	EnableWatch              bool
	ResyncInterval           time.Duration
	MaxConcurrentActions     int
	CircuitBreakerThreshold  int
	CircuitBreakerCooldown   time.Duration
	ProtectedNamespaces      []string
	IncludedNamespaces       []string
	ExcludedNamespaces       []string
	WatchResources           []string
	DryRunRemediation        bool
	LogLevel                 string
}

// LoadFromEnv loads configuration from environment variables with defaults
func LoadFromEnv() (*Config, error) {
	clusterID := os.Getenv("SKYOPS_CLUSTER_ID")
	if clusterID == "" {
		return nil, errors.New("missing required environment variable: SKYOPS_CLUSTER_ID")
	}

	agentToken := os.Getenv("SKYOPS_AGENT_TOKEN")
	if agentToken == "" {
		return nil, errors.New("missing required environment variable: SKYOPS_AGENT_TOKEN")
	}

	serverURL := os.Getenv("SKYOPS_SERVER_URL")
	if serverURL == "" {
		return nil, errors.New("missing required environment variable: SKYOPS_SERVER_URL")
	}
	parsedURL, err := url.Parse(serverURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, errors.New("SKYOPS_SERVER_URL must be an absolute HTTP(S) URL")
	}
	serverURL = strings.TrimRight(serverURL, "/")

	agentVersion := os.Getenv("SKYOPS_AGENT_VERSION")
	if agentVersion == "" {
		agentVersion = "v1.5.0"
	}

	agentID := os.Getenv("SKYOPS_AGENT_ID")
	if agentID == "" {
		podName := os.Getenv("POD_NAME")
		if podName != "" {
			agentID = podName
		} else {
			hostname, _ := os.Hostname()
			if hostname != "" {
				agentID = hostname
			} else {
				agentID = "agent-" + strconv.FormatInt(time.Now().UnixNano(), 36)
			}
		}
	}

	spoolDir := os.Getenv("SKYOPS_SPOOL_DIR")
	if spoolDir == "" {
		spoolDir = "/var/spool/skyops-agent"
	}

	protectedNsEnv := os.Getenv("SKYOPS_PROTECTED_NAMESPACES")
	var protectedNs []string
	if protectedNsEnv != "" {
		for _, ns := range strings.Split(protectedNsEnv, ",") {
			trimmed := strings.TrimSpace(ns)
			if trimmed != "" {
				protectedNs = append(protectedNs, trimmed)
			}
		}
	}
	if len(protectedNs) == 0 {
		protectedNs = []string{"kube-system", "kube-public", "kube-node-lease", "skyops"}
	}

	return &Config{
		ClusterID:               clusterID,
		AgentID:                 agentID,
		AgentToken:              agentToken,
		ServerURL:               serverURL,
		AgentVersion:            agentVersion,
		NodeName:                os.Getenv("NODE_NAME"),
		PodNamespace:            os.Getenv("POD_NAMESPACE"),
		PodName:                 os.Getenv("POD_NAME"),
		HeartbeatInterval:       durationEnv("SKYOPS_HEARTBEAT_INTERVAL", 30*time.Second),
		TelemetryInterval:       durationEnv("SKYOPS_TELEMETRY_INTERVAL", 15*time.Second),
		ActionPollInterval:      durationEnv("SKYOPS_ACTION_POLL_INTERVAL", 5*time.Second),
		QueueCapacity:           positiveIntEnv("SKYOPS_QUEUE_CAPACITY", 500),
		MaxRetries:              positiveIntEnv("SKYOPS_MAX_RETRIES", 5),
		BackoffBase:             durationEnv("SKYOPS_BACKOFF_BASE", time.Second),
		MetricsPort:             positiveIntEnv("SKYOPS_METRICS_PORT", 8080),
		EnableMetrics:           boolEnv("SKYOPS_ENABLE_METRICS", true),
		SpoolDir:                spoolDir,
		SpoolMaxBytes:           int64Env("SKYOPS_SPOOL_MAX_BYTES", 50*1024*1024), // 50MB default
		EnableSpool:             boolEnv("SKYOPS_ENABLE_SPOOL", true),
		EnableWatch:             boolEnv("SKYOPS_ENABLE_WATCH", true),
		ResyncInterval:          durationEnv("SKYOPS_RESYNC_INTERVAL", 10*time.Minute),
		MaxConcurrentActions:    positiveIntEnv("SKYOPS_MAX_CONCURRENT_ACTIONS", 1),
		CircuitBreakerThreshold: positiveIntEnv("SKYOPS_CIRCUIT_BREAKER_THRESHOLD", 5),
		CircuitBreakerCooldown:  durationEnv("SKYOPS_CIRCUIT_BREAKER_COOLDOWN", 30*time.Second),
		ProtectedNamespaces:     protectedNs,
		IncludedNamespaces:      parseCommaList("SKYOPS_INCLUDED_NAMESPACES"),
		ExcludedNamespaces:      parseCommaList("SKYOPS_EXCLUDED_NAMESPACES"),
		WatchResources:          parseCommaList("SKYOPS_WATCH_RESOURCES"),
		DryRunRemediation:       boolEnv("SKYOPS_DRY_RUN_REMEDIATION", false),
		LogLevel:                strings.ToUpper(os.Getenv("SKYOPS_LOG_LEVEL")),
	}, nil
}

func parseCommaList(name string) []string {
	val := os.Getenv(name)
	if val == "" {
		return nil
	}
	var res []string
	for _, item := range strings.Split(val, ",") {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			res = append(res, trimmed)
		}
	}
	return res
}

func boolEnv(name string, fallback bool) bool {
	val := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if val == "true" || val == "1" || val == "yes" {
		return true
	}
	if val == "false" || val == "0" || val == "no" {
		return false
	}
	return fallback
}

func int64Env(name string, fallback int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(name), 10, 64); err == nil && v > 0 {
		return v
	}
	return fallback
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(name)); err == nil && v > 0 {
		return v
	}
	return fallback
}
func positiveIntEnv(name string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(name)); err == nil && v > 0 {
		return v
	}
	return fallback
}
