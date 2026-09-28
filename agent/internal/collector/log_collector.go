package collector

import (
	"context"
	"log/slog"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

// LogCollector coordinates on-demand and diagnostic Kubernetes container log retrieval
type LogCollector struct {
	cfg       *config.Config
	client    *transport.Client
	k8sClient *InClusterK8sClient
	metrics   *metrics.Registry
}

func NewLogCollector(cfg *config.Config, client *transport.Client, k8sClient *InClusterK8sClient, m *metrics.Registry) *LogCollector {
	if m == nil {
		m = metrics.Default
	}
	return &LogCollector{
		cfg:       cfg,
		client:    client,
		k8sClient: k8sClient,
		metrics:   m,
	}
}

// Start begins periodic polling for on-demand pod log retrieval requests
func (l *LogCollector) Start(ctx context.Context) {
	if l.k8sClient == nil {
		slog.Warn("Log collector disabled (no in-cluster Kubernetes client available)")
		return
	}

	pollInterval := l.cfg.LogPollInterval
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	slog.Info("Kubernetes pod log collector started", "pollInterval", pollInterval.String())

	for {
		select {
		case <-ctx.Done():
			slog.Info("Kubernetes pod log collector shutting down")
			return
		case <-ticker.C:
			l.pollAndProcess(ctx)
		}
	}
}

func (l *LogCollector) pollAndProcess(ctx context.Context) {
	// 1. Process log requests
	requests, err := l.client.PollLogRequests(ctx)
	if err != nil {
		if err != transport.ErrCircuitOpen {
			slog.Debug("Log request polling notice", "error", err)
		}
	} else if len(requests) > 0 {
		slog.Info("Received on-demand pod log collection requests", "count", len(requests))
		for _, req := range requests {
			l.processLogRequest(ctx, req)
		}
	}

	// 2. Process metrics server live verification requests
	l.pollMetricsServerVerification(ctx)
}

func (l *LogCollector) pollMetricsServerVerification(ctx context.Context) {
	reqs, err := l.client.PollMetricsServerVerificationRequests(ctx)
	if err != nil {
		if err != transport.ErrCircuitOpen {
			slog.Debug("Metrics server verification polling notice", "error", err)
		}
		return
	}
	if len(reqs) == 0 {
		return
	}

	slog.Info("Received Metrics Server live verification requests", "count", len(reqs))
	for _, req := range reqs {
		result := VerifyMetricsServer(ctx, l.k8sClient, l.cfg.ClusterID, req.ID)
		if sendErr := l.client.SendMetricsServerVerificationResult(ctx, result); sendErr != nil {
			slog.Warn("Failed to send metrics server verification result to backend", "requestId", req.ID, "error", sendErr)
		} else {
			slog.Info("Successfully sent metrics server verification result", "requestId", req.ID, "status", result.Status)
		}
	}
}

func (l *LogCollector) processLogRequest(ctx context.Context, req transport.LogRequest) {
	tailLines := req.TailLines
	if tailLines <= 0 {
		tailLines = l.cfg.MaxLogTailLines
	}
	if tailLines > 1000 {
		tailLines = 1000
	}

	limitBytes := req.LimitBytes
	if limitBytes <= 0 {
		limitBytes = l.cfg.MaxLogBytes
	}
	if limitBytes > 1024*1024 {
		limitBytes = 1024 * 1024
	}

	opts := PodLogOptions{
		Container:    req.Container,
		TailLines:    tailLines,
		Previous:     req.Previous,
		Timestamps:   req.Timestamps,
		SinceSeconds: req.SinceSeconds,
		LimitBytes:   limitBytes,
		Timeout:      l.cfg.LogRequestTimeout,
	}

	res, err := l.k8sClient.GetPodLogs(ctx, req.Namespace, req.PodName, opts)
	if err != nil {
		slog.Error("Failed to retrieve container logs from Kubernetes API",
			"namespace", req.Namespace,
			"pod", req.PodName,
			"container", req.Container,
			"error", err,
		)
		return
	}

	payload := transport.LogIngestPayload{
		RequestID:    req.ID,
		Namespace:    req.Namespace,
		PodName:      req.PodName,
		Container:    req.Container,
		Logs:         res.Logs,
		Previous:     req.Previous,
		Status:       res.Status,
		ErrorMessage: res.ErrorMessage,
	}

	if sendErr := l.client.SendPodLogs(ctx, payload); sendErr != nil {
		slog.Warn("Failed to send pod logs to SkyOps backend",
			"namespace", req.Namespace,
			"pod", req.PodName,
			"container", req.Container,
			"error", sendErr,
		)
	} else {
		slog.Info("Successfully collected and forwarded pod logs",
			"namespace", req.Namespace,
			"pod", req.PodName,
			"container", req.Container,
			"status", res.Status,
			"lines", res.LinesReturned,
			"bytes", res.BytesRead,
			"previous", req.Previous,
		)
	}
}
