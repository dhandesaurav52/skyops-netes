package remediation

import (
	"context"
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/transport"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestStateMachineTransitions(t *testing.T) {
	sm := NewStateMachine("act-101", "idem-101", "ReplacePodImage")

	if sm.State() != StateProposed {
		t.Fatalf("expected state PROPOSED, got %s", sm.State())
	}

	// Valid sequence: Proposed -> Validating -> Approved -> Executing -> Verifying -> Succeeded
	if err := sm.Transition(StateValidating, "validating"); err != nil {
		t.Fatal(err)
	}
	if err := sm.Transition(StateApproved, "approved"); err != nil {
		t.Fatal(err)
	}
	if err := sm.Transition(StateExecuting, "executing"); err != nil {
		t.Fatal(err)
	}
	if err := sm.Transition(StateVerifying, "verifying"); err != nil {
		t.Fatal(err)
	}
	if err := sm.Transition(StateSucceeded, "succeeded"); err != nil {
		t.Fatal(err)
	}

	// Illegal transition from terminal state
	if err := sm.Transition(StateExecuting, "illegal"); err == nil {
		t.Fatal("expected error on transition from terminal state")
	}

	rec := sm.Record()
	if len(rec.AuditLog) != 6 {
		t.Errorf("expected 6 audit log entries, got %d", len(rec.AuditLog))
	}
}

func TestRemediationExecutionWithFakeK8s(t *testing.T) {
	ctx := context.Background()
	fakeClient := fake.NewSimpleClientset()

	// Seed target standalone Pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-pod",
			Namespace: "default",
			UID:       "uid-pod-123",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "web",
					Image: "nginx:1.20",
				},
			},
		},
	}
	_, err := fakeClient.CoreV1().Pods("default").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		t.Fatal(err)
	}

	cfg := &config.Config{
		ClusterID:            "cls-test",
		AgentToken:           "tok",
		ServerURL:            "http://localhost:9999",
		MaxConcurrentActions: 2,
		TelemetryInterval:    10 * time.Second,
		ActionPollInterval:   10 * time.Second,
	}
	transportClient := transport.NewClient(cfg)
	reg := metrics.NewRegistry()

	manager := NewManager(cfg, transportClient, fakeClient, reg)

	action := &transport.RemediationAction{
		ID:                   "act-1",
		IdempotencyKey:       "key-1",
		ClusterID:            "cls-test",
		Type:                 "ReplacePodImage",
		Target:               transport.ActionTarget{Kind: "Pod", Namespace: "default", Name: "api-pod", Container: "web", UID: "uid-pod-123"},
		ExpectedCurrentValue: "nginx:1.20",
		ProposedValue:        "nginx:1.21",
	}

	manager.ProcessAction(ctx, action)

	rec := manager.GetExecutionRecord("key-1")
	if rec == nil {
		t.Fatal("expected execution record stored")
	}

	if rec.State != StateSucceeded {
		t.Fatalf("expected action to succeed, got %s (err: %s)", rec.State, rec.ErrorMessage)
	}

	// Verify pod now has nginx:1.21
	updatedPod, err := fakeClient.CoreV1().Pods("default").Get(ctx, "api-pod", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if updatedPod.Spec.Containers[0].Image != "nginx:1.21" {
		t.Fatalf("expected image nginx:1.21, got %s", updatedPod.Spec.Containers[0].Image)
	}

	// Idempotent retry with same key should recognize it
	manager.ProcessAction(ctx, action)
}
