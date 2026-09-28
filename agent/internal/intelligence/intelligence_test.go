package intelligence

import (
	"testing"

	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestParseQuantities(t *testing.T) {
	if m := ParseQuantityToMillicores("500m"); m != 500 {
		t.Errorf("expected 500 millicores, got %d", m)
	}
	if m := ParseQuantityToMillicores("2"); m != 2000 {
		t.Errorf("expected 2000 millicores, got %d", m)
	}
	if b := ParseQuantityToBytes("128Mi"); b != 128*1024*1024 {
		t.Errorf("expected 134217728 bytes, got %d", b)
	}
	if b := ParseQuantityToBytes("2Gi"); b != 2*1024*1024*1024 {
		t.Errorf("expected 2147483648 bytes, got %d", b)
	}
}

func TestAnalyzeNode(t *testing.T) {
	node := &types.ResourceObservation{
		Name: "worker-1",
		Kind: "Node",
		StatusSummary: map[string]interface{}{
			"allocatable": map[string]interface{}{
				"cpu":    "4",
				"memory": "8Gi",
				"pods":   "110",
			},
		},
		Conditions: []types.ConditionStatus{
			{Type: "Ready", Status: "True"},
			{Type: "MemoryPressure", Status: "False"},
		},
	}

	pods := []*types.ResourceObservation{
		{
			Kind:      "Pod",
			Namespace: "default",
			Name:      "heavy-pod-1",
			NodeName:  "worker-1",
			Status:    "Running",
			Containers: []types.ContainerStatus{
				{
					Name:          "app",
					CpuRequest:    "2000m",
					MemoryRequest: "4Gi",
					CpuUsage:      "1500m",
					MemoryUsage:   "3Gi",
				},
			},
		},
	}

	intel := AnalyzeNode(node, pods)
	if intel.AllocatableCPU != 4000 {
		t.Errorf("expected 4000 millicores, got %d", intel.AllocatableCPU)
	}
	if intel.RequestedCPU != 2000 {
		t.Errorf("expected 2000 millicores requested, got %d", intel.RequestedCPU)
	}
	if intel.CPURequestedPercent != 50.0 {
		t.Errorf("expected 50%% CPU requested, got %f", intel.CPURequestedPercent)
	}
	if intel.RunningPodCount != 1 {
		t.Errorf("expected 1 running pod, got %d", intel.RunningPodCount)
	}
	if len(intel.TopCPUPods) != 1 || intel.TopCPUPods[0].Name != "heavy-pod-1" {
		t.Errorf("expected heavy-pod-1 in top CPU pods")
	}
}
