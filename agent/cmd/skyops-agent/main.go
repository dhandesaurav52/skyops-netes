package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/skyops-io/skyops/agent/internal/collector"
	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/heartbeat"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/queue"
	"github.com/skyops-io/skyops/agent/internal/remediation"
	"github.com/skyops-io/skyops/agent/internal/spool"
	"github.com/skyops-io/skyops/agent/internal/transport"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Version holds the authoritative release version of the agent, injected at build-time via ldflags (-X main.Version=...)
var Version = "v1.5.0"

func printPairingBanner(connectionCode string) {
	fmt.Println()
	fmt.Println("========================================")
	fmt.Println("       SkyOps Agent Installed           ")
	fmt.Println("========================================")
	fmt.Println()
	fmt.Println("Cluster detected successfully.")
	fmt.Println()
	fmt.Println("Connection Key:")
	fmt.Println()
	fmt.Printf("    %s\n", connectionCode)
	fmt.Println()
	fmt.Println("Enter this key in the SkyOps dashboard.")
	fmt.Println()
	fmt.Println("This key expires in 15 minutes.")
	fmt.Println()
	fmt.Println("========================================")
	fmt.Println()
}

func main() {
	// Initialize structured logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	slog.Info("Starting SkyOps Kubernetes Agent", "version", Version)

	// Load configuration
	cfg, err := config.LoadFromEnv()
	if err != nil {
		slog.Error("Configuration failure", "error", err)
		fmt.Fprintf(os.Stderr, "FATAL: %v\n", err)
		os.Exit(1)
	}

	// Ensure runtime version takes precedence if injected
	if Version != "" {
		cfg.AgentVersion = Version
	}

	slog.Info("Configuration loaded successfully",
		"clusterId", cfg.ClusterID,
		"serverUrl", cfg.ServerURL,
		"heartbeatInterval", cfg.HeartbeatInterval.String(),
		"telemetryInterval", cfg.TelemetryInterval.String(),
		"spoolEnabled", cfg.EnableSpool,
	)

	// Set up root context with signal cancellation
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	// Initialize Self-Observability (Prometheus Metrics & Health Server)
	var metricsServer *metrics.Server
	if cfg.EnableMetrics {
		metricsServer = metrics.NewServer(cfg.MetricsPort, metrics.Default)
		go func() {
			if err := metricsServer.Start(ctx); err != nil {
				slog.Warn("Metrics HTTP server stopped with error", "error", err)
			}
		}()
	}

	// Initialize Durable Local Spool for offline telemetry buffering
	var durableSpool *spool.Spool
	if cfg.EnableSpool {
		sp, err := spool.NewSpool(cfg.SpoolDir, cfg.SpoolMaxBytes)
		if err != nil {
			slog.Warn("Failed to initialize durable disk spool (continuing in-memory)", "spoolDir", cfg.SpoolDir, "error", err)
		} else {
			durableSpool = sp
			slog.Info("Durable telemetry disk spool initialized", "dir", sp.Dir(), "maxBytes", cfg.SpoolMaxBytes)
		}
	}

	// Initialize components
	telemetryQueue := queue.NewBoundedQueue(cfg.QueueCapacity)
	transportClient := transport.NewClient(cfg)

	// Probe Kubernetes in-cluster API client (custom REST)
	kClient, kErr := collector.NewInClusterK8sClient()
	liveK8sVersion := ""
	if kErr != nil {
		slog.Warn("In-cluster Kubernetes client notice", "reason", kErr.Error())
	} else {
		probeCtx, probeCancel := context.WithTimeout(ctx, 5*time.Second)
		if ver, verErr := kClient.GetServerVersion(probeCtx); verErr == nil && ver != "" {
			liveK8sVersion = ver
			slog.Info("Discovered Kubernetes API version", "version", liveK8sVersion)
		}
		probeCancel()
	}

	// Probe standard client-go Kubernetes client for safe mutation and remediation
	var clientGoK8s kubernetes.Interface
	if restCfg, err := rest.InClusterConfig(); err == nil {
		if cs, csErr := kubernetes.NewForConfig(restCfg); csErr == nil {
			clientGoK8s = cs
			slog.Info("Initialized client-go Kubernetes client for safe cluster remediation")
		} else {
			slog.Warn("Failed to create client-go client from config", "error", csErr)
		}
	} else {
		slog.Info("Client-go in-cluster config not found (remediation running in simulated/policy mode)")
	}

	// Register Agent on startup
	regPayload := transport.RegistrationPayload{
		AgentVersion: cfg.AgentVersion,
		K8sVersion:   liveK8sVersion,
	}

	regResp, regErr := transportClient.RegisterAgent(ctx, regPayload)
	if regErr != nil {
		slog.Warn("Initial registration notice (will retry via heartbeat)", "error", regErr)
	} else if regResp != nil {
		slog.Info("Agent registered successfully with central platform", "clusterId", regResp.ClusterID, "status", regResp.Status)
		if regResp.ConnectionCode != "" {
			printPairingBanner(regResp.ConnectionCode)
		}
	}

	// Initialize Heartbeat Service
	heartbeatService := heartbeat.NewService(cfg, transportClient)
	if liveK8sVersion != "" {
		heartbeatService.SetK8sVersion(liveK8sVersion)
	}
	heartbeatService.SetQueue(telemetryQueue)
	if durableSpool != nil {
		heartbeatService.SetSpool(durableSpool)
	}

	// Initialize Resource Collector & Event-Driven Telemetry Engine
	resourceCollector := collector.NewCollector(cfg, transportClient, telemetryQueue, kClient)
	resourceCollector.SetStateUpdater(heartbeatService)
	if durableSpool != nil {
		resourceCollector.SetSpool(durableSpool)
	}

	// Initialize Safe Remediation Lifecycle Manager
	remediationManager := remediation.NewManager(cfg, transportClient, clientGoK8s, metrics.Default)

	// Mark metrics server as ready
	if metricsServer != nil {
		metricsServer.SetReady(true)
	}

	// Start background routines
	go heartbeatService.Start(ctx)
	go resourceCollector.Start(ctx)
	go remediationManager.Start(ctx)

	slog.Info("SkyOps Agent running in active enterprise observation and remediation mode")

	// Wait for shutdown signal
	<-ctx.Done()
	slog.Info("Shutdown signal received, draining queues and gracefully terminating...")

	if metricsServer != nil {
		metricsServer.SetReady(false)
	}

	// 5-second graceful drain timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	<-shutdownCtx.Done()
	slog.Info("SkyOps Agent successfully exited")
}
