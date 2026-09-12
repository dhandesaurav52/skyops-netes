package heartbeat

import (
	"context"
	"log/slog"
	"math/rand"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/queue"
	"github.com/skyops-io/skyops/agent/internal/spool"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

// ConnectionState represents current agent connectivity status
type ConnectionState string

const (
	StateConnected    ConnectionState = "CONNECTED"
	StateReconnecting ConnectionState = "RECONNECTING"
	StateStale        ConnectionState = "STALE"
	StateOffline      ConnectionState = "OFFLINE"
)

// Service periodically pulses health heartbeats to SkyOps with automatic reconnection
type Service struct {
	cfg               *config.Config
	client            *transport.Client
	queue             *queue.BoundedQueue
	spool             *spool.Spool
	metrics           *metrics.Registry
	startTime         time.Time
	mu                sync.RWMutex
	nodeCount         int
	podCount          int
	k8sVersion        string
	state             ConnectionState
	reconnectAttempts int
}

func NewService(cfg *config.Config, client *transport.Client) *Service {
	return &Service{
		cfg:               cfg,
		client:            client,
		nodeCount:         0,
		podCount:          0,
		k8sVersion:        "",
		startTime:         time.Now(),
		metrics:           metrics.Default,
		state:             StateConnected,
		reconnectAttempts: 0,
	}
}

func (s *Service) SetQueue(q *queue.BoundedQueue) {
	s.queue = q
}

func (s *Service) SetSpool(sp *spool.Spool) {
	s.spool = sp
}

func (s *Service) SetMetrics(r *metrics.Registry) {
	s.metrics = r
}

func (s *Service) State() ConnectionState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state
}

func (s *Service) UpdateCounts(nodes, pods int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodeCount = nodes
	s.podCount = pods
}

func (s *Service) UpdateTelemetryState(nodes, pods int, k8sVersion string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodeCount = nodes
	s.podCount = pods
	if k8sVersion != "" {
		s.k8sVersion = k8sVersion
	}
}

func (s *Service) SetK8sVersion(ver string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ver != "" {
		s.k8sVersion = ver
	}
}

func (s *Service) Start(ctx context.Context) {
	slog.Info("Heartbeat service started", "interval", s.cfg.HeartbeatInterval.String())

	// Send initial immediate heartbeat
	s.send(ctx)

	for {
		s.mu.RLock()
		currentState := s.state
		attempts := s.reconnectAttempts
		s.mu.RUnlock()

		var interval time.Duration
		if currentState == StateConnected {
			interval = s.cfg.HeartbeatInterval
		} else {
			// Exponential backoff with jitter when reconnecting
			// 2s, 4s, 8s, 16s capped at min(HeartbeatInterval, 30s)
			shift := attempts
			if shift > 4 {
				shift = 4
			}
			backoffSec := 1 << shift
			if backoffSec < 2 {
				backoffSec = 2
			}
			backoff := time.Duration(backoffSec)*time.Second + time.Duration(rand.Intn(500))*time.Millisecond
			if backoff > s.cfg.HeartbeatInterval {
				backoff = s.cfg.HeartbeatInterval
			}
			interval = backoff
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			slog.Info("Heartbeat service stopping")
			return
		case <-timer.C:
			s.send(ctx)
		}
	}
}

func (s *Service) send(ctx context.Context) {
	s.mu.RLock()
	nodes := s.nodeCount
	pods := s.podCount
	k8sVer := s.k8sVersion
	currState := s.state
	s.mu.RUnlock()

	var qDepth int
	if s.queue != nil {
		qDepth = s.queue.Len()
	}

	var spoolBytes int64
	if s.spool != nil {
		_, spoolBytes = s.spool.Stats()
	}

	circuitState := "CLOSED"
	if cb := s.client.CircuitBreaker(); cb != nil {
		circuitState = string(cb.State())
	}

	payload := transport.HeartbeatPayload{
		ClusterID:       s.cfg.ClusterID,
		AgentID:         s.cfg.AgentID,
		AgentVersion:    s.cfg.AgentVersion,
		K8sVersion:      k8sVer,
		NodeCount:       nodes,
		PodCount:        pods,
		Timestamp:       time.Now().UnixMilli(),
		UptimeSeconds:   time.Since(s.startTime).Seconds(),
		QueueDepth:      qDepth,
		SpoolBytes:      spoolBytes,
		CircuitState:    circuitState,
		ConnectionState: string(currState),
		Capabilities:    []string{"metrics", "watches", "spooling", "remediation", "graph", "intelligence"},
	}

	if err := s.client.SendHeartbeat(ctx, payload); err != nil {
		s.mu.Lock()
		if s.state == StateConnected {
			s.state = StateReconnecting
			s.reconnectAttempts = 1
			s.mu.Unlock()

			slog.Warn("Agent disconnected from central platform",
				"event", "agent_disconnected",
				"clusterId", s.cfg.ClusterID,
				"error", err,
			)
			slog.Warn("Heartbeat dispatch failed",
				"event", "agent_heartbeat_failed",
				"clusterId", s.cfg.ClusterID,
				"error", err,
			)
			slog.Info("Agent automatic reconnect initiated (reusing existing credentials)",
				"event", "agent_reconnect_started",
				"clusterId", s.cfg.ClusterID,
			)
		} else {
			s.reconnectAttempts++
			attempts := s.reconnectAttempts
			s.mu.Unlock()

			slog.Warn("Agent reconnect attempt failed, will retry",
				"event", "agent_reconnect_failed",
				"clusterId", s.cfg.ClusterID,
				"attempt", attempts,
				"error", err,
			)
		}
	} else {
		s.mu.Lock()
		wasReconnecting := s.state != StateConnected
		s.state = StateConnected
		s.reconnectAttempts = 0
		s.mu.Unlock()

		if wasReconnecting {
			slog.Info("Agent automatic reconnection succeeded",
				"event", "agent_reconnect_succeeded",
				"clusterId", s.cfg.ClusterID,
			)
			slog.Info("Agent heartbeat recovered",
				"event", "agent_heartbeat_recovered",
				"clusterId", s.cfg.ClusterID,
				"nodes", nodes,
				"pods", pods,
			)
		} else {
			slog.Debug("Heartbeat sent successfully",
				"event", "agent_heartbeat_sent",
				"clusterId", s.cfg.ClusterID,
				"nodes", nodes,
				"pods", pods,
				"k8sVersion", k8sVer,
			)
		}
	}
}

