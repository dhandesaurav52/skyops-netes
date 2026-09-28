package remediation

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/policy"
	"github.com/skyops-io/skyops/agent/internal/transport"
	"k8s.io/client-go/kubernetes"
)

// Manager coordinates the end-to-end remediation lifecycle
type Manager struct {
	cfg             *config.Config
	client          *transport.Client
	policyEngine    *policy.PolicyEngine
	executor        *Executor
	metrics         *metrics.Registry
	mu              sync.RWMutex
	idempotencyMap  map[string]*ExecutionRecord // key: IdempotencyKey or ActionID
	recentRecords   []*ExecutionRecord
}

func NewManager(cfg *config.Config, client *transport.Client, k8sClient kubernetes.Interface, metricsReg *metrics.Registry) *Manager {
	if metricsReg == nil {
		metricsReg = metrics.Default
	}
	pe := policy.NewPolicyEngine(cfg.ClusterID, cfg.ProtectedNamespaces, cfg.MaxConcurrentActions, cfg.DryRunRemediation)
	var exec *Executor
	if k8sClient != nil {
		exec = NewExecutor(k8sClient)
	}

	return &Manager{
		cfg:            cfg,
		client:         client,
		policyEngine:   pe,
		executor:       exec,
		metrics:        metricsReg,
		idempotencyMap: make(map[string]*ExecutionRecord),
	}
}

// Start begins periodic polling for approved remediation actions
func (m *Manager) Start(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.ActionPollInterval)
	defer ticker.Stop()

	slog.Info("Remediation execution manager started", "pollInterval", m.cfg.ActionPollInterval.String())

	for {
		select {
		case <-ctx.Done():
			slog.Info("Remediation execution manager shutting down")
			return
		case <-ticker.C:
			m.pollAndProcess(ctx)
		}
	}
}

func (m *Manager) pollAndProcess(ctx context.Context) {
	actions, err := m.client.PollActions(ctx)
	if err != nil {
		if err != transport.ErrCircuitOpen {
			slog.Debug("Action polling notice", "error", err)
		}
		return
	}

	if len(actions) == 0 {
		return
	}

	slog.Info("Claimed remediation actions from backend", "count", len(actions))
	for i := range actions {
		m.ProcessAction(ctx, &actions[i])
	}
}

// ProcessAction coordinates state transitions, pre-checks, execution, verification, and rollback
func (m *Manager) ProcessAction(ctx context.Context, action *transport.RemediationAction) {
	if action == nil {
		return
	}

	// 1. Idempotency Check
	idempotencyKey := action.IdempotencyKey
	if idempotencyKey == "" {
		idempotencyKey = action.ID
	}

	m.mu.Lock()
	if existing, found := m.idempotencyMap[idempotencyKey]; found {
		m.mu.Unlock()
		slog.Info("Remediation action previously executed (idempotent replay)", "idempotencyKey", idempotencyKey, "state", existing.State)
		return
	}
	m.mu.Unlock()

	sm := NewStateMachine(action.ID, idempotencyKey, action.Type)

	// Update Prometheus metrics
	m.metrics.Counter("skyops_agent_actions_total").Inc(map[string]string{"type": action.Type})

	// 2. Validate Phase
	_ = sm.Transition(StateValidating, "Validating policy constraints and action parameters")
	if err := m.policyEngine.Validate(action); err != nil {
		_ = sm.Transition(StateRejected, fmt.Sprintf("Policy validation rejected action: %v", err))
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, fmt.Sprintf("Policy rejected: %v", err))
		m.metrics.Counter("skyops_agent_action_failures_total").Inc(map[string]string{"type": action.Type, "reason": "policy_rejected"})
		return
	}

	if !m.policyEngine.AcquireSlot() {
		_ = sm.Transition(StateRejected, "Concurrent action limit reached")
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, "Concurrent action limit reached; try again later")
		return
	}
	defer m.policyEngine.ReleaseSlot()

	if m.executor == nil {
		_ = sm.Transition(StateFailed, "In-cluster Kubernetes client not available for execution")
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, "K8s client not available")
		return
	}

	// 3. Approved Phase
	_ = sm.Transition(StateApproved, "Action approved by policy engine")

	// Pre-conditions & live state capture
	prevLiveState, err := m.executor.PreconditionCheck(ctx, action)
	if err != nil {
		_ = sm.Transition(StateFailed, fmt.Sprintf("Precondition check failed: %v", err))
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, fmt.Sprintf("Precondition failed: %v", err))
		m.metrics.Counter("skyops_agent_action_failures_total").Inc(map[string]string{"type": action.Type, "reason": "precondition_failed"})
		return
	}

	// Idempotent no-op if already in desired state
	if prevLiveState == action.ProposedValue {
		_ = sm.Transition(StateSucceeded, "Target already in desired state (no mutation needed)")
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, true, "Already in desired state")
		return
	}

	if m.policyEngine.IsDryRun() {
		_ = sm.Transition(StateSucceeded, "Dry-run execution succeeded (no cluster mutation performed)")
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, true, "Dry-run executed successfully")
		return
	}

	// 4. Executing Phase
	_ = sm.Transition(StateExecuting, fmt.Sprintf("Executing mutation on %s/%s", action.Target.Namespace, action.Target.Name))
	execErr := m.executor.Execute(ctx, action)
	if execErr != nil {
		_ = sm.Transition(StateFailed, fmt.Sprintf("Execution failed: %v", execErr))
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, fmt.Sprintf("Execution error: %v", execErr))
		m.metrics.Counter("skyops_agent_action_failures_total").Inc(map[string]string{"type": action.Type, "reason": "execution_failed"})
		return
	}

	// 5. Verifying Phase
	_ = sm.Transition(StateVerifying, "Verifying cluster reached desired state")
	verifyErr := m.executor.Verify(ctx, action, 30*time.Second)
	if verifyErr != nil {
		slog.Warn("Remediation verification failed; initiating automatic rollback", "action", action.ID, "error", verifyErr)
		_ = sm.Transition(StateRollingBack, fmt.Sprintf("Verification failed: %v; rolling back to previous state %s", verifyErr, prevLiveState))

		rbErr := m.executor.Rollback(ctx, action, prevLiveState)
		if rbErr != nil {
			_ = sm.Transition(StateFailed, fmt.Sprintf("Rollback failed: %v after verification error: %v", rbErr, verifyErr))
			m.recordCompletion(sm.Record())
			_ = m.client.ReportActionResult(ctx, action.ID, false, fmt.Sprintf("Verification and rollback failed: %v", rbErr))
			return
		}

		_ = sm.Transition(StateRolledBack, "Target safely restored to previous state")
		m.recordCompletion(sm.Record())
		_ = m.client.ReportActionResult(ctx, action.ID, false, fmt.Sprintf("Verification failed: %v; successfully rolled back", verifyErr))
		return
	}

	// 6. Succeeded Phase
	_ = sm.Transition(StateSucceeded, "Remediation verified successfully")
	m.recordCompletion(sm.Record())
	_ = m.client.ReportActionResult(ctx, action.ID, true, "Remediation completed and verified successfully")
}

func (m *Manager) recordCompletion(rec ExecutionRecord) {
	m.mu.Lock()
	defer m.mu.Unlock()

	recPtr := &rec
	if rec.IdempotencyKey != "" {
		m.idempotencyMap[rec.IdempotencyKey] = recPtr
	}
	m.idempotencyMap[rec.ActionID] = recPtr
	m.recentRecords = append(m.recentRecords, recPtr)
	if len(m.recentRecords) > 100 {
		m.recentRecords = m.recentRecords[1:]
	}
}

// GetExecutionRecord returns an execution record by actionID or idempotencyKey
func (m *Manager) GetExecutionRecord(key string) *ExecutionRecord {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.idempotencyMap[key]
}
