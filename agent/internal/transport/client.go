package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
)

// Client handles secure authenticated communication with the SkyOps backend API
type Client struct {
	cfg        *config.Config
	httpClient *http.Client
}

func NewClient(cfg *config.Config) *Client {
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
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

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
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
	ClusterID    string `json:"clusterId"`
	AgentVersion string `json:"agentVersion"`
	K8sVersion   string `json:"k8sVersion"`
	NodeCount    int    `json:"nodeCount"`
	PodCount     int    `json:"podCount"`
	Timestamp    int64  `json:"timestamp"`
}

// RemediationAction is deliberately narrow: agents reject every action type other
// than a reviewed pod image replacement.
type RemediationAction struct {
	ID                   string                                            `json:"id"`
	IncidentID           string                                            `json:"incidentId"`
	Type                 string                                            `json:"type"`
	Target               struct{ Kind, Namespace, Name, Container string } `json:"target"`
	FieldPath            string                                            `json:"fieldPath"`
	ExpectedCurrentValue string                                            `json:"expectedCurrentValue"`
	ProposedValue        string                                            `json:"proposedValue"`
	ExecutionID          string                                            `json:"executionId,omitempty"`
	IdempotencyKey       string                                            `json:"idempotencyKey,omitempty"`
	ExpiresAt            int64                                             `json:"expiresAt,omitempty"`
	ClusterID            string                                            `json:"clusterId,omitempty"`
}

// SendHeartbeat sends a periodic heartbeat with exponential retry backoff
func (c *Client) SendHeartbeat(ctx context.Context, payload HeartbeatPayload) error {
	url := fmt.Sprintf("%s/api/v1/agent/heartbeat", c.cfg.ServerURL)
	return c.postWithRetry(ctx, url, payload)
}

// SendTelemetry dispatches observed Kubernetes resources & events
func (c *Client) SendTelemetry(ctx context.Context, payload interface{}) error {
	url := fmt.Sprintf("%s/api/v1/agent/telemetry", c.cfg.ServerURL)
	return c.postWithRetry(ctx, url, payload)
}

func (c *Client) PollActions(ctx context.Context) ([]RemediationAction, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/api/v1/agent/actions", c.cfg.ServerURL), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.AgentToken))
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("action poll returned HTTP %d: %s", resp.StatusCode, body)
	}
	var body struct {
		Actions []RemediationAction `json:"actions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	return body.Actions, nil
}

func (c *Client) ReportActionResult(ctx context.Context, actionID string, success bool, message string) error {
	return c.postWithRetry(ctx, fmt.Sprintf("%s/api/v1/agent/actions/%s/result", c.cfg.ServerURL, actionID), map[string]interface{}{"success": success, "message": message})
}

func (c *Client) postWithRetry(ctx context.Context, url string, payload interface{}) error {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt <= c.cfg.MaxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
		if err != nil {
			return err
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.cfg.AgentToken))
		req.Header.Set("User-Agent", fmt.Sprintf("SkyOpsAgent/%s", c.cfg.AgentVersion))

		resp, err := c.httpClient.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil // Success
			}
			body, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("server returned error %d: %s", resp.StatusCode, string(body))
		} else {
			lastErr = err
		}

		// Calculate exponential backoff with jitter
		backoff := time.Duration(1<<attempt)*c.cfg.BackoffBase + time.Duration(rand.Intn(500))*time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}

	return fmt.Errorf("exhausted %d retries: %w", c.cfg.MaxRetries, lastErr)
}
