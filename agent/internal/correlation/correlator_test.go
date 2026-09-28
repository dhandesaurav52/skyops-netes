package correlation

import (
	"testing"

	"github.com/skyops-io/skyops/agent/internal/graph"
	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestCorrelationOOMKilled(t *testing.T) {
	g := graph.NewGraph()
	c := NewCorrelator(g)

	resources := []types.ResourceObservation{
		{
			Kind:      "Pod",
			Namespace: "production",
			Name:      "payment-service-abcde",
			NodeName:  "node-1",
			Containers: []types.ContainerStatus{
				{
					Name:                  "payment",
					Image:                 "payment:v2.1",
					RestartCount:          3,
					LastTerminationReason: "OOMKilled",
					LastExitCode:          137,
					MemoryLimit:           "256Mi",
				},
			},
		},
	}

	events := []types.EventObservation{
		{
			ObjectKind: "Pod",
			Namespace:  "production",
			ObjectName: "payment-service-abcde",
			Reason:     "OOMKilling",
			Message:    "Kill process 1234 (payment) score 999 and sacrifice child",
		},
	}

	signals := c.Correlate(resources, events)
	if len(signals) == 0 {
		t.Fatalf("expected at least 1 incident signal, got 0")
	}

	sig := signals[0]
	if sig.Type != "OOM_KILLED" || sig.Severity != "CRITICAL" {
		t.Errorf("expected CRITICAL OOM_KILLED signal, got %s %s", sig.Type, sig.Severity)
	}
	if len(sig.CorrelatedEvents) != 1 {
		t.Errorf("expected 1 correlated event, got %d", len(sig.CorrelatedEvents))
	}
	if sig.Facts["exitCode"] != 137 {
		t.Errorf("expected exitCode 137 in facts, got %v", sig.Facts["exitCode"])
	}
}
