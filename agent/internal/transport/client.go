package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
)

// Client handles secure authenticated communication with the SkyOps backend API
type Client struct {
	cfg            *config.Config
	httpClient     *http.Client
	circuitBreaker *CircuitBreaker
	metrics        *metrics.Registry
}

func NewClient(cfg *config.Config) *Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}

	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   15 * time.Second,
		},
		circuitBreaker: NewCircuitBreaker(cfg.CircuitBreakerThreshold, cfg.CircuitBreakerCooldown),
		metrics:        metrics.Default,
	}
}

func (c *Client) SetMetrics(r *metrics.Registry) {
	c.metrics = r
}

func (c *Client) CircuitBreaker() *CircuitBreaker {
	return c.circuitBreaker
}

// RegistrationPayload schema matching SkyOps Agent Register API
type RegistrationPayload struct {
	AgentVersion string `json:"agentVersion"`
	K8sVersion   string `json:"k8sVersion"`
}

// RegistrationResponse schema returned upon registration
type RegistrationResponse struct {
	Status         string `json:"status"`
	ClusterID      string `json:"clusterId"`
	ConnectionCode string `json:"connectionCode,omitempty"`
	ServerTime     int64  `json:"serverTime"`
}

// RegisterAgent registers the agent on startup and retrieves initial cluster handshake details
func (c *Client) RegisterAgent(ctx context.Context, payload RegistrationPayload) (*RegistrationResponse, error) {
	url := fmt.Sprintf("%s/api/v1/agent/register", c.cfg.ServerURL)
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal registration payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.AgentToken))
	req.Header.Set("User-Agent", fmt.Sprintf("SkyOpsAgent/%s", c.cfg.AgentVersion))
	req.Header.Set("X-Agent-ID", c.cfg.AgentID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
		return nil, fmt.Errorf("registration returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var regResp RegistrationResponse
	if err := json.NewDecoder(resp.Body).Decode(&regResp); err != nil {
		return nil, fmt.Errorf("failed to decode registration response: %w", err)
	}

	return &regResp, nil
}

// HeartbeatPayload schema matching SkyOps Ingestion API
type HeartbeatPayload struct {
	ClusterID     string            `json:"clusterId"`
	AgentID       string            `json:"agentId,omitempty"`
	AgentVersion  string            `json:"agentVersion"`
	K8sVersion    string            `json:"k8sVersion"`
	NodeCount     int               `json:"nodeCount"`
	PodCount      int               `json:"podCount"`
	Timestamp     int64             `json:"timestamp"`
	UptimeSeconds float64           `json:"uptimeSeconds,omitempty"`
	Capabilities  []string          `json:"capabilities,omitempty"`
	QueueDepth    int               `json:"queueDepth,omitempty"`
	SpoolBytes    int64             `json:"spoolBytes,omitempty"`
	CircuitState  string            `json:"circuitState,omitempty"`
	Metrics       map[string]int64  `json:"metrics,omitempty"`
}

// ActionTarget details the resource targeted by remediation
type ActionTarget struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Container string `json:"container,omitempty"`
	UID       string `json:"uid,omitempty"`
}

// RemediationAction represents an authorized action claimed from backend
type RemediationAction struct {
	ID                   string                 `json:"id"`
	IncidentID           string                 `json:"incidentId"`
	Type                 string                 `json:"type"`
	Target               ActionTarget           `json:"target"`
	FieldPath            string                 `json:"fieldPath"`
	ExpectedCurrentValue string                 `json:"expectedCurrentValue"`
	ProposedValue        string                 `json:"proposedValue"`
	Parameters           map[string]interface{} `json:"parameters,omitempty"`
	ExecutionID          string                 `json:"executionId,omitempty"`
	IdempotencyKey       string                 `json:"idempotencyKey,omitempty"`
	ExpiresAt            int64                  `json:"expiresAt,omitempty"`
	ClusterID            string                 `json:"clusterId,omitempty"`
	RequestedBy          string                 `json:"requestedBy,omitempty"`
}

// SendHeartbeat sends a periodic heartbeat with exponential retry backoff
func (c *Client) SendHeartbeat(ctx context.Context, payload HeartbeatPayload) error {
	url := fmt.Sprintf("%s/api/v1/agent/heartbeat", c.cfg.ServerURL)
	return c.postWithRetry(ctx, url, payload, "heartbeat")
}

// SendTelemetry dispatches observed Kubernetes resources & events
func (c *Client) SendTelemetry(ctx context.Context, payload interface{}) error {
	url := fmt.Sprintf("%s/api/v1/agent/telemetry", c.cfg.ServerURL)
	return c.postWithRetry(ctx, url, payload, "telemetry")
}

func (c *Client) PollActions(ctx context.Context) ([]RemediationAction, error) {
	if !c.circuitBreaker.Allow() {
		return nil, ErrCircuitOpen
	}

	url := fmt.Sprintf("%s/api/v1/agent/actions", c.cfg.ServerURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.AgentToken))
	req.Header.Set("User-Agent", fmt.Sprintf("SkyOpsAgent/%s", c.cfg.AgentVersion))
	req.Header.Set("X-Agent-ID", c.cfg.AgentID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.circuitBreaker.RecordFailure()
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.circuitBreaker.RecordFailure()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
		return nil, fmt.Errorf("action poll returned HTTP %d: %s", resp.StatusCode, body)
	}

	c.circuitBreaker.RecordSuccess()

	var body struct {
		Actions []RemediationAction `json:"actions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Actions, nil
}

func (c *Client) ReportActionResult(ctx context.Context, actionID string, success bool, message string) error {
	url := fmt.Sprintf("%s/api/v1/agent/actions/%s/result", c.cfg.ServerURL, actionID)
	payload := map[string]interface{}{
		"success":   success,
		"message":   message,
		"timestamp": time.Now().UnixMilli(),
		"agentId":   c.cfg.AgentID,
	}
	return c.postWithRetry(ctx, url, payload, "action_result")
}

func (c *Client) postWithRetry(ctx context.Context, url string, payload interface{}, opType string) error {
	if !c.circuitBreaker.Allow() {
		return ErrCircuitOpen
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	batchID := uuid.New().String()
	var lastErr error

	for attempt := 0; attempt <= c.cfg.MaxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.AgentToken))
		req.Header.Set("User-Agent", fmt.Sprintf("SkyOpsAgent/%s", c.cfg.AgentVersion))
		req.Header.Set("X-Cluster-ID", c.cfg.ClusterID)
		req.Header.Set("X-Agent-ID", c.cfg.AgentID)
		req.Header.Set("X-Batch-ID", batchID)
		req.Header.Set("X-Schema-Version", "1.0")

		start := time.Now()
		resp, err := c.httpClient.Do(req)
		duration := time.Since(start)

		if err == nil {
			respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
			resp.Body.Close()

			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				c.circuitBreaker.RecordSuccess()
				if c.metrics != nil {
					c.metrics.Counter("skyops_agent_upload_success_total").Inc(map[string]string{"type": opType})
					c.metrics.Gauge("skyops_agent_upload_latency_ms").Set(duration.Milliseconds(), nil)
				}
				return nil // Success
			}

			// Retry classification
			statusCode := resp.StatusCode
			lastErr = fmt.Errorf("server returned HTTP %d: %s", statusCode, string(respBody))

			// Non-retriable client errors
			if statusCode == http.StatusBadRequest || statusCode == http.StatusNotFound {
				// Don't retry bad request
				return lastErr
			}
			if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
				slog.Error("Authentication rejected by backend", "status", statusCode)
				return lastErr
			}

			// Respect Retry-After if provided (429 or 503)
			var retryAfterSec int
			if retryHeader := resp.Header.Get("Retry-After"); retryHeader != "" {
				if s, err := strconv.Atoi(retryHeader); err == nil && s > 0 {
					retryAfterSec = s
				}
			}

			c.circuitBreaker.RecordFailure()
			if c.metrics != nil {
				c.metrics.Counter("skyops_agent_upload_failures_total").Inc(map[string]string{"type": opType, "code": strconv.Itoa(statusCode)})
			}

			if attempt == c.cfg.MaxRetries {
				break
			}

			backoff := time.Duration(1<<attempt)*c.cfg.BackoffBase + time.Duration(rand.Intn(500))*time.Millisecond
			if retryAfterSec > 0 {
				backoff = time.Duration(retryAfterSec) * time.Second
			}

			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		} else {
			c.circuitBreaker.RecordFailure()
			lastErr = err
			if c.metrics != nil {
				c.metrics.Counter("skyops_agent_upload_failures_total").Inc(map[string]string{"type": opType, "code": "network_error"})
			}

			if attempt == c.cfg.MaxRetries {
				break
			}

			backoff := time.Duration(1<<attempt)*c.cfg.BackoffBase + time.Duration(rand.Intn(500))*time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
		}
	}

	if errors.Is(lastErr, context.Canceled) || errors.Is(lastErr, context.DeadlineExceeded) {
		return lastErr
	}

	return fmt.Errorf("exhausted %d retries: %w", c.cfg.MaxRetries, lastErr)
}
