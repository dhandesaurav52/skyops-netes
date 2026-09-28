package policy

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/transport"
)

var (
	ErrActionNotPermitted     = errors.New("remediation action type is not allowed")
	ErrProtectedNamespace     = errors.New("remediation in protected namespace is prohibited")
	ErrActionExpired          = errors.New("remediation action has expired")
	ErrClusterMismatch        = errors.New("remediation action cluster ID does not match agent cluster")
	ErrMissingParameters      = errors.New("remediation action is missing required parameters")
	ErrConcurrenyLimitExceeded = errors.New("maximum concurrent remediation actions limit reached")
)

// AllowedActionTypes define strictly typed, safe remediation primitives
var AllowedActionTypes = map[string]bool{
	"ReplacePodImage": true,
	"RestartPod":      true,
	"ScaleDeployment": true,
}

// PolicyEngine enforces zero-trust security guardrails before any cluster mutation
type PolicyEngine struct {
	mu                  sync.Mutex
	clusterID           string
	protectedNamespaces map[string]bool
	maxConcurrent       int
	activeActions       int
	dryRun              bool
}

func NewPolicyEngine(clusterID string, protected []string, maxConcurrent int, dryRun bool) *PolicyEngine {
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}
	protectedMap := make(map[string]bool)
	for _, ns := range protected {
		protectedMap[strings.ToLower(strings.TrimSpace(ns))] = true
	}
	// Always protect kube-system and kube-public
	protectedMap["kube-system"] = true
	protectedMap["kube-public"] = true
	protectedMap["kube-node-lease"] = true

	return &PolicyEngine{
		clusterID:           clusterID,
		protectedNamespaces: protectedMap,
		maxConcurrent:       maxConcurrent,
		dryRun:              dryRun,
	}
}

// Validate checks whether an incoming remediation action passes all security policies
func (pe *PolicyEngine) Validate(action *transport.RemediationAction) error {
	if action == nil {
		return errors.New("nil remediation action")
	}

	// 1. Cluster ID match (if specified)
	if action.ClusterID != "" && action.ClusterID != pe.clusterID {
		return fmt.Errorf("%w: action cluster=%q agent cluster=%q", ErrClusterMismatch, action.ClusterID, pe.clusterID)
	}

	// 2. Action type allowlist check
	if !AllowedActionTypes[action.Type] {
		return fmt.Errorf("%w: %q (allowed: ReplacePodImage, RestartPod, ScaleDeployment)", ErrActionNotPermitted, action.Type)
	}

	// 3. Expiration check
	if action.ExpiresAt > 0 {
		now := time.Now().UnixMilli()
		if now > action.ExpiresAt {
			return fmt.Errorf("%w: expired at %d, current time is %d", ErrActionExpired, action.ExpiresAt, now)
		}
	}

	// 4. Protected namespace check
	targetNS := strings.ToLower(strings.TrimSpace(action.Target.Namespace))
	if pe.protectedNamespaces[targetNS] {
		return fmt.Errorf("%w: namespace %q is protected against automated remediation", ErrProtectedNamespace, action.Target.Namespace)
	}

	// 5. Basic parameter validation
	if action.Target.Name == "" || action.Target.Namespace == "" {
		return fmt.Errorf("%w: target namespace and name must be specified", ErrMissingParameters)
	}

	switch action.Type {
	case "ReplacePodImage":
		if action.Target.Container == "" {
			return fmt.Errorf("%w: container name required for ReplacePodImage", ErrMissingParameters)
		}
		if action.ProposedValue == "" {
			return fmt.Errorf("%w: proposed image value required for ReplacePodImage", ErrMissingParameters)
		}
		if action.ExpectedCurrentValue == "" {
			return fmt.Errorf("%w: expectedCurrentValue required for ReplacePodImage to ensure safety", ErrMissingParameters)
		}
	case "RestartPod":
		if action.Target.Kind != "Pod" && action.Target.Kind != "Deployment" {
			return fmt.Errorf("%w: RestartPod target kind must be Pod or Deployment", ErrMissingParameters)
		}
	case "ScaleDeployment":
		if action.Target.Kind != "Deployment" {
			return fmt.Errorf("%w: ScaleDeployment target kind must be Deployment", ErrMissingParameters)
		}
		if action.ProposedValue == "" {
			return fmt.Errorf("%w: proposed replica count required for ScaleDeployment", ErrMissingParameters)
		}
	}

	// 6. Concurrency check
	pe.mu.Lock()
	defer pe.mu.Unlock()
	if pe.activeActions >= pe.maxConcurrent {
		return ErrConcurrenyLimitExceeded
	}

	return nil
}

func (pe *PolicyEngine) AcquireSlot() bool {
	pe.mu.Lock()
	defer pe.mu.Unlock()
	if pe.activeActions >= pe.maxConcurrent {
		return false
	}
	pe.activeActions++
	return true
}

func (pe *PolicyEngine) ReleaseSlot() {
	pe.mu.Lock()
	defer pe.mu.Unlock()
	if pe.activeActions > 0 {
		pe.activeActions--
	}
}

func (pe *PolicyEngine) IsDryRun() bool {
	return pe.dryRun
}
