package policy

import (
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/transport"
)

func TestPolicyEngineValidation(t *testing.T) {
	pe := NewPolicyEngine("cls-1", []string{"kube-system", "production-critical"}, 2, false)

	// 1. Valid ReplacePodImage
	validAction := &transport.RemediationAction{
		ID:                   "act-1",
		ClusterID:            "cls-1",
		Type:                 "ReplacePodImage",
		Target:               transport.ActionTarget{Kind: "Pod", Namespace: "default", Name: "app-1", Container: "web"},
		ExpectedCurrentValue: "web:v1.0",
		ProposedValue:        "web:v1.1",
		ExpiresAt:            time.Now().Add(5 * time.Minute).UnixMilli(),
	}
	if err := pe.Validate(validAction); err != nil {
		t.Fatalf("expected valid action, got error: %v", err)
	}

	// 2. Reject protected namespace
	protectedAction := &transport.RemediationAction{
		ID:                   "act-2",
		ClusterID:            "cls-1",
		Type:                 "ReplacePodImage",
		Target:               transport.ActionTarget{Kind: "Pod", Namespace: "kube-system", Name: "coredns", Container: "coredns"},
		ExpectedCurrentValue: "coredns:v1",
		ProposedValue:        "coredns:v2",
	}
	if err := pe.Validate(protectedAction); err == nil {
		t.Fatal("expected error on protected namespace kube-system")
	}

	// 3. Reject unknown action type (command injection defense)
	arbitraryAction := &transport.RemediationAction{
		ID:        "act-3",
		ClusterID: "cls-1",
		Type:      "ExecuteShellScript",
		Target:    transport.ActionTarget{Namespace: "default", Name: "pod-1"},
	}
	if err := pe.Validate(arbitraryAction); err == nil {
		t.Fatal("expected error on arbitrary un-allowlisted action")
	}

	// 4. Reject expired action
	expiredAction := &transport.RemediationAction{
		ID:                   "act-4",
		ClusterID:            "cls-1",
		Type:                 "ReplacePodImage",
		Target:               transport.ActionTarget{Kind: "Pod", Namespace: "default", Name: "app-1", Container: "web"},
		ExpectedCurrentValue: "web:v1.0",
		ProposedValue:        "web:v1.1",
		ExpiresAt:            time.Now().Add(-5 * time.Minute).UnixMilli(),
	}
	if err := pe.Validate(expiredAction); err == nil {
		t.Fatal("expected error on expired action")
	}
}
