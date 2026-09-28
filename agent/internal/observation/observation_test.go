package observation

import (
	"testing"

	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestStateChangeDetector(t *testing.T) {
	d := NewDetector()

	initialPod := &types.ResourceObservation{
		ID:        "pod-1",
		Kind:      "Pod",
		Namespace: "default",
		Name:      "web-app",
		Status:    "Running",
		Health:    "HEALTHY",
		Containers: []types.ContainerStatus{
			{
				Name:         "nginx",
				RestartCount: 0,
				State:        "running",
			},
		},
	}

	// First observation shouldn't emit changes
	changes1 := d.Evaluate(initialPod)
	if len(changes1) != 0 {
		t.Fatalf("expected 0 changes for initial observation, got %d", len(changes1))
	}

	// Second observation: restart count increased + CrashLoopBackOff
	updatedPod := &types.ResourceObservation{
		ID:        "pod-1",
		Kind:      "Pod",
		Namespace: "default",
		Name:      "web-app",
		Status:    "CrashLoopBackOff",
		Health:    "CRITICAL",
		Containers: []types.ContainerStatus{
			{
				Name:                  "nginx",
				RestartCount:          1,
				State:                 "waiting",
				WaitingReason:         "CrashLoopBackOff",
				LastTerminationReason: "OOMKilled",
				LastExitCode:          137,
			},
		},
	}

	changes2 := d.Evaluate(updatedPod)
	if len(changes2) < 2 {
		t.Fatalf("expected at least 2 changes (status change + restart + waiting), got %d", len(changes2))
	}

	hasRestart := false
	hasStatus := false
	for _, c := range changes2 {
		if c.ChangeType == "RESTART_COUNT_INCREASED" {
			hasRestart = true
		}
		if c.ChangeType == "STATUS_CHANGE" {
			hasStatus = true
		}
	}
	if !hasRestart || !hasStatus {
		t.Errorf("expected both restart and status change detected")
	}
}

func TestCanonicalObservationCreation(t *testing.T) {
	raw := types.ResourceObservation{
		Kind:      "Node",
		Name:      "node-1",
		Namespace: "",
		Status:    "Ready",
	}

	obs := NewCanonical("cls-1", "agent-1", "uid-node-1", "Node", "", "node-1", "12345", TypeSnapshot, SeverityInfo, raw)
	if obs.SchemaVersion != "1.0" {
		t.Errorf("expected schemaVersion 1.0, got %s", obs.SchemaVersion)
	}
	if obs.ObservationID == "" {
		t.Errorf("expected non-empty observation ID")
	}
	if obs.ResourceUID != "uid-node-1" {
		t.Errorf("expected uid-node-1, got %s", obs.ResourceUID)
	}
}
