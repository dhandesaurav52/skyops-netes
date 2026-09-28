package intelligence

import (
	"sort"
	"strconv"
	"strings"

	"github.com/skyops-io/skyops/agent/internal/types"
)

type TopPodUsage struct {
	Namespace    string `json:"namespace"`
	Name         string `json:"name"`
	UsageCPU     int64  `json:"usageCpuMillicores"`
	UsageMemory  int64  `json:"usageMemoryBytes"`
	RequestCPU   int64  `json:"requestCpuMillicores"`
	RequestMemory int64 `json:"requestMemoryBytes"`
}

type NodeIntelligence struct {
	NodeName               string        `json:"nodeName"`
	AllocatableCPU         int64         `json:"allocatableCpuMillicores"`
	AllocatableMemory      int64         `json:"allocatableMemoryBytes"`
	AllocatablePods        int64         `json:"allocatablePods"`
	RequestedCPU           int64         `json:"requestedCpuMillicores"`
	RequestedMemory        int64         `json:"requestedMemoryBytes"`
	LimitsCPU              int64         `json:"limitsCpuMillicores"`
	LimitsMemory           int64         `json:"limitsMemoryBytes"`
	UsageCPU               int64         `json:"usageCpuMillicores"`
	UsageMemory            int64         `json:"usageMemoryBytes"`
	RunningPodCount        int           `json:"runningPodCount"`
	PodDensityPercent      float64       `json:"podDensityPercent"`
	CPURequestedPercent    float64       `json:"cpuRequestedPercent"`
	MemoryRequestedPercent float64       `json:"memoryRequestedPercent"`
	CPUUsagePercent        float64       `json:"cpuUsagePercent"`
	MemoryUsagePercent     float64       `json:"memoryUsagePercent"`
	CPUHeadroomMillicores  int64         `json:"cpuHeadroomMillicores"`
	MemoryHeadroomBytes    int64         `json:"memoryHeadroomBytes"`
	CPUSaturationRisk      string        `json:"cpuSaturationRisk"`    // "HIGH", "MEDIUM", "LOW", "NONE"
	MemorySaturationRisk   string        `json:"memorySaturationRisk"` // "HIGH", "MEDIUM", "LOW", "NONE"
	HasMemoryPressure      bool          `json:"hasMemoryPressure"`
	HasDiskPressure        bool          `json:"hasDiskPressure"`
	HasPIDPressure         bool          `json:"hasPidPressure"`
	TopCPUPods             []TopPodUsage `json:"topCpuPods"`
	TopMemoryPods          []TopPodUsage `json:"topMemoryPods"`
}

// ParseQuantityToMillicores converts K8s cpu (e.g. "500m", "2", "1.5") to millicores
func ParseQuantityToMillicores(val string) int64 {
	val = strings.TrimSpace(val)
	if val == "" {
		return 0
	}
	if strings.HasSuffix(val, "m") {
		numStr := strings.TrimSuffix(val, "m")
		v, _ := strconv.ParseInt(numStr, 10, 64)
		return v
	}
	if strings.HasSuffix(val, "n") {
		numStr := strings.TrimSuffix(val, "n")
		v, _ := strconv.ParseInt(numStr, 10, 64)
		return v / 1000000
	}
	if strings.HasSuffix(val, "u") {
		numStr := strings.TrimSuffix(val, "u")
		v, _ := strconv.ParseInt(numStr, 10, 64)
		return v / 1000
	}
	if f, err := strconv.ParseFloat(val, 64); err == nil {
		return int64(f * 1000)
	}
	return 0
}

// ParseQuantityToBytes converts K8s memory (e.g. "128Mi", "2Gi", "500M", "1024Ki") to bytes
func ParseQuantityToBytes(val string) int64 {
	val = strings.TrimSpace(val)
	if val == "" {
		return 0
	}

	units := []struct {
		suffix     string
		multiplier int64
	}{
		{"Ki", 1024},
		{"Mi", 1024 * 1024},
		{"Gi", 1024 * 1024 * 1024},
		{"Ti", 1024 * 1024 * 1024 * 1024},
		{"k", 1000},
		{"M", 1000 * 1000},
		{"G", 1000 * 1000 * 1000},
		{"T", 1000 * 1000 * 1000 * 1000},
	}

	for _, u := range units {
		if strings.HasSuffix(val, u.suffix) {
			numStr := strings.TrimSuffix(val, u.suffix)
			if f, err := strconv.ParseFloat(numStr, 64); err == nil {
				return int64(f * float64(u.multiplier))
			}
			return 0
		}
	}

	if v, err := strconv.ParseInt(val, 10, 64); err == nil {
		return v
	}
	return 0
}

// AnalyzeNode calculates deep capacity, utilization, and saturation risks for a single node
func AnalyzeNode(node *types.ResourceObservation, pods []*types.ResourceObservation) NodeIntelligence {
	intel := NodeIntelligence{
		NodeName: node.Name,
	}

	// 1. Allocatable resources from node StatusSummary
	if node.StatusSummary != nil {
		if alloc, ok := node.StatusSummary["allocatable"].(map[string]interface{}); ok {
			if cpuStr, ok := alloc["cpu"].(string); ok {
				intel.AllocatableCPU = ParseQuantityToMillicores(cpuStr)
			}
			if memStr, ok := alloc["memory"].(string); ok {
				intel.AllocatableMemory = ParseQuantityToBytes(memStr)
			}
			if podStr, ok := alloc["pods"].(string); ok {
				if p, err := strconv.ParseInt(podStr, 10, 64); err == nil {
					intel.AllocatablePods = p
				}
			}
		}
	}

	// Conditions
	for _, c := range node.Conditions {
		if c.Status == "True" {
			switch c.Type {
			case "MemoryPressure":
				intel.HasMemoryPressure = true
			case "DiskPressure":
				intel.HasDiskPressure = true
			case "PIDPressure":
				intel.HasPIDPressure = true
			}
		}
	}

	// 2. Aggregate requests and limits from pods running on this node
	var podUsages []TopPodUsage
	runningCount := 0

	for _, pod := range pods {
		if pod.NodeName != node.Name {
			continue
		}
		if pod.Status == "Succeeded" || pod.Status == "Failed" {
			continue
		}
		runningCount++

		var podReqCPU, podReqMem int64
		var podLimCPU, podLimMem int64
		var podUseCPU, podUseMem int64

		for _, c := range pod.Containers {
			podReqCPU += ParseQuantityToMillicores(c.CpuRequest)
			podReqMem += ParseQuantityToBytes(c.MemoryRequest)
			podLimCPU += ParseQuantityToMillicores(c.CpuLimit)
			podLimMem += ParseQuantityToBytes(c.MemoryLimit)
			podUseCPU += ParseQuantityToMillicores(c.CpuUsage)
			podUseMem += ParseQuantityToBytes(c.MemoryUsage)
		}

		intel.RequestedCPU += podReqCPU
		intel.RequestedMemory += podReqMem
		intel.LimitsCPU += podLimCPU
		intel.LimitsMemory += podLimMem
		intel.UsageCPU += podUseCPU
		intel.UsageMemory += podUseMem

		podUsages = append(podUsages, TopPodUsage{
			Namespace:     pod.Namespace,
			Name:          pod.Name,
			UsageCPU:      podUseCPU,
			UsageMemory:   podUseMem,
			RequestCPU:    podReqCPU,
			RequestMemory: podReqMem,
		})
	}

	intel.RunningPodCount = runningCount

	// Percentages & Headroom
	if intel.AllocatableCPU > 0 {
		intel.CPURequestedPercent = float64(intel.RequestedCPU) / float64(intel.AllocatableCPU) * 100
		intel.CPUUsagePercent = float64(intel.UsageCPU) / float64(intel.AllocatableCPU) * 100
		intel.CPUHeadroomMillicores = intel.AllocatableCPU - intel.RequestedCPU
		if intel.CPUHeadroomMillicores < 0 {
			intel.CPUHeadroomMillicores = 0
		}
	}

	if intel.AllocatableMemory > 0 {
		intel.MemoryRequestedPercent = float64(intel.RequestedMemory) / float64(intel.AllocatableMemory) * 100
		intel.MemoryUsagePercent = float64(intel.UsageMemory) / float64(intel.AllocatableMemory) * 100
		intel.MemoryHeadroomBytes = intel.AllocatableMemory - intel.RequestedMemory
		if intel.MemoryHeadroomBytes < 0 {
			intel.MemoryHeadroomBytes = 0
		}
	}

	if intel.AllocatablePods > 0 {
		intel.PodDensityPercent = float64(intel.RunningPodCount) / float64(intel.AllocatablePods) * 100
	}

	// Saturation Risk Evaluation
	// CPU
	effectiveCPUPct := intel.CPURequestedPercent
	if intel.CPUUsagePercent > effectiveCPUPct {
		effectiveCPUPct = intel.CPUUsagePercent
	}
	if effectiveCPUPct >= 90 {
		intel.CPUSaturationRisk = "HIGH"
	} else if effectiveCPUPct >= 75 {
		intel.CPUSaturationRisk = "MEDIUM"
	} else if effectiveCPUPct >= 50 {
		intel.CPUSaturationRisk = "LOW"
	} else {
		intel.CPUSaturationRisk = "NONE"
	}

	// Memory
	effectiveMemPct := intel.MemoryRequestedPercent
	if intel.MemoryUsagePercent > effectiveMemPct {
		effectiveMemPct = intel.MemoryUsagePercent
	}
	if intel.HasMemoryPressure || effectiveMemPct >= 90 {
		intel.MemorySaturationRisk = "HIGH"
	} else if effectiveMemPct >= 80 {
		intel.MemorySaturationRisk = "MEDIUM"
	} else if effectiveMemPct >= 60 {
		intel.MemorySaturationRisk = "LOW"
	} else {
		intel.MemorySaturationRisk = "NONE"
	}

	// Top CPU Consumers (sort descending)
	sort.Slice(podUsages, func(i, j int) bool {
		valI := podUsages[i].UsageCPU
		if valI == 0 {
			valI = podUsages[i].RequestCPU
		}
		valJ := podUsages[j].UsageCPU
		if valJ == 0 {
			valJ = podUsages[j].RequestCPU
		}
		return valI > valJ
	})
	topCPU := podUsages
	if len(topCPU) > 5 {
		topCPU = topCPU[:5]
	}
	intel.TopCPUPods = topCPU

	// Top Memory Consumers (sort descending)
	sort.Slice(podUsages, func(i, j int) bool {
		valI := podUsages[i].UsageMemory
		if valI == 0 {
			valI = podUsages[i].RequestMemory
		}
		valJ := podUsages[j].UsageMemory
		if valJ == 0 {
			valJ = podUsages[j].RequestMemory
		}
		return valI > valJ
	})
	topMem := podUsages
	if len(topMem) > 5 {
		topMem = topMem[:5]
	}
	intel.TopMemoryPods = topMem

	return intel
}
