package inspectors

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	// DefaultDiskPressureThresholdPct is the volume disk usage percentage triggering a warning
	DefaultDiskPressureThresholdPct = 85.0
	// DefaultDiskCriticalThresholdPct triggers an urgent critical volume alarm
	DefaultDiskCriticalThresholdPct = 95.0
	// DefaultInodePressureThresholdPct is the inode exhaustion warning percentage
	DefaultInodePressureThresholdPct = 85.0
)

// DiskStat represents the raw block and inode storage metrics for a mount point
type DiskStat struct {
	TotalBytes        uint64  `json:"totalBytes"`
	UsedBytes         uint64  `json:"usedBytes"`
	FreeBytes         uint64  `json:"freeBytes"`
	AvailableBytes    uint64  `json:"availableBytes"`
	UsedPercent       float64 `json:"usedPercent"`
	TotalInodes       uint64  `json:"totalInodes"`
	UsedInodes        uint64  `json:"usedInodes"`
	FreeInodes        uint64  `json:"freeInodes"`
	InodesUsedPercent float64 `json:"inodesUsedPercent"`
	IsReadOnly        bool    `json:"isReadOnly"`
}

// PVCInspectionReport contains comprehensive diagnostic telemetry for a PersistentVolumeClaim
type PVCInspectionReport struct {
	Name                 string            `json:"name"`
	Namespace            string            `json:"namespace"`
	VolumeName           string            `json:"volumeName"`
	StorageClassName     string            `json:"storageClassName"`
	AccessModes          []string          `json:"accessModes"`
	Phase                string            `json:"phase"` // Bound, Pending, Lost
	RequestedCapacity    string            `json:"requestedCapacity"`
	AllocatedCapacity    string            `json:"allocatedCapacity,omitempty"`
	MountPath            string            `json:"mountPath,omitempty"`
	MountStatus          string            `json:"mountStatus"` // MOUNTED, UNMOUNTED, READ_ONLY, PRESSURE, OK
	DiskStat             *DiskStat         `json:"diskStat,omitempty"`
	DiskPressure         bool              `json:"diskPressure"`
	DiskPressureSeverity string            `json:"diskPressureSeverity"` // NORMAL, WARNING, CRITICAL
	InodePressure        bool              `json:"inodePressure"`
	Warnings             []string          `json:"warnings"`
	Labels               map[string]string `json:"labels,omitempty"`
	InspectedAt          int64             `json:"inspectedAt"`
}

// StatfsFn allows unit tests to inject custom filesystem metrics
type StatfsFn func(path string) (*DiskStat, error)

// PVCInspector audits PersistentVolumeClaims and local storage mount health
type PVCInspector struct {
	k8sClient             kubernetes.Interface
	hostMountBasePaths    []string
	diskPressureThreshold float64
	statfsFn              StatfsFn
	mu                    sync.RWMutex
}

// NewPVCInspector instantiates a new Persistent Volume Claim inspector
func NewPVCInspector(k8sClient kubernetes.Interface, hostMountBasePaths []string, diskPressureThreshold float64) *PVCInspector {
	if diskPressureThreshold <= 0 {
		diskPressureThreshold = DefaultDiskPressureThresholdPct
	}
	if len(hostMountBasePaths) == 0 {
		hostMountBasePaths = []string{
			"/var/lib/kubelet/pods",
			"/var/lib/kubelet/plugins/kubernetes.io/csi",
			"/mnt",
			"/data",
		}
	}

	return &PVCInspector{
		k8sClient:             k8sClient,
		hostMountBasePaths:    hostMountBasePaths,
		diskPressureThreshold: diskPressureThreshold,
		statfsFn:              defaultStatfs,
	}
}

// SetStatfsFn configures a custom filesystem stat function (useful for mocking in unit tests)
func (p *PVCInspector) SetStatfsFn(fn StatfsFn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.statfsFn = fn
}

// defaultStatfs reads live disk blocks and inodes via syscall.Statfs
func defaultStatfs(path string) (*DiskStat, error) {
	var stat syscall.Statfs_t
	err := syscall.Statfs(path, &stat)
	if err != nil {
		return nil, err
	}

	totalBytes := stat.Blocks * uint64(stat.Bsize)
	freeBytes := stat.Bfree * uint64(stat.Bsize)
	availBytes := stat.Bavail * uint64(stat.Bsize)
	var usedBytes uint64
	if totalBytes >= freeBytes {
		usedBytes = totalBytes - freeBytes
	}

	var usedPercent float64
	if totalBytes > 0 {
		usedPercent = (float64(usedBytes) / float64(totalBytes)) * 100.0
	}

	totalInodes := stat.Files
	freeInodes := stat.Ffree
	var usedInodes uint64
	if totalInodes >= freeInodes {
		usedInodes = totalInodes - freeInodes
	}

	var inodesPercent float64
	if totalInodes > 0 {
		inodesPercent = (float64(usedInodes) / float64(totalInodes)) * 100.0
	}

	isReadOnly := (stat.Flags & syscall.MS_RDONLY) != 0

	return &DiskStat{
		TotalBytes:        totalBytes,
		UsedBytes:         usedBytes,
		FreeBytes:         freeBytes,
		AvailableBytes:    availBytes,
		UsedPercent:       usedPercent,
		TotalInodes:       totalInodes,
		UsedInodes:        usedInodes,
		FreeInodes:        freeInodes,
		InodesUsedPercent: inodesPercent,
		IsReadOnly:        isReadOnly,
	}, nil
}

// Inspect audits PVCs in a single namespace
func (p *PVCInspector) Inspect(ctx context.Context, namespace string) ([]PVCInspectionReport, error) {
	if p.k8sClient == nil {
		return nil, fmt.Errorf("kubernetes client interface is nil")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	pvcList, err := p.k8sClient.CoreV1().PersistentVolumeClaims(namespace).List(timeoutCtx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to query PersistentVolumeClaims in namespace %s: %w", namespace, err)
	}

	var reports []PVCInspectionReport
	for i := range pvcList.Items {
		item := &pvcList.Items[i]
		report := p.evaluatePVC(item)
		reports = append(reports, report)
	}

	return reports, nil
}

// InspectAll audits PVCs across all namespaces in the cluster
func (p *PVCInspector) InspectAll(ctx context.Context) ([]PVCInspectionReport, error) {
	return p.Inspect(ctx, metav1.NamespaceAll)
}

// evaluatePVC extracts spec and live mount statistics for a single PVC
func (p *PVCInspector) evaluatePVC(pvc *corev1.PersistentVolumeClaim) PVCInspectionReport {
	now := time.Now().UnixMilli()

	report := PVCInspectionReport{
		Name:                 pvc.Name,
		Namespace:            pvc.Namespace,
		VolumeName:           pvc.Spec.VolumeName,
		Phase:                string(pvc.Status.Phase),
		DiskPressureSeverity: "NORMAL",
		Warnings:             make([]string, 0),
		Labels:               pvc.Labels,
		InspectedAt:          now,
	}

	if pvc.Spec.StorageClassName != nil {
		report.StorageClassName = *pvc.Spec.StorageClassName
	}

	for _, mode := range pvc.Spec.AccessModes {
		report.AccessModes = append(report.AccessModes, string(mode))
	}

	// Requested capacity
	if req, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
		report.RequestedCapacity = req.String()
	}

	// Actual allocated capacity
	if capRes, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		report.AllocatedCapacity = capRes.String()
	}

	// Check if unbound or pending
	if pvc.Status.Phase == corev1.ClaimPending {
		report.MountStatus = "PENDING"
		report.Warnings = append(report.Warnings, "PersistentVolumeClaim is unbound and pending volume provisioning")
		return report
	} else if pvc.Status.Phase == corev1.ClaimLost {
		report.MountStatus = "LOST"
		report.Warnings = append(report.Warnings, "PersistentVolumeClaim has lost its underlying PersistentVolume binding")
		return report
	}

	// Locate host mount path
	mountPath, found := p.locateVolumeMountPath(pvc.Spec.VolumeName, pvc.Namespace, pvc.Name)
	if !found {
		report.MountStatus = "BOUND_UNMOUNTED_LOCALLY"
		return report
	}

	report.MountPath = mountPath

	// Query filesystem disk usage
	p.mu.RLock()
	statFn := p.statfsFn
	p.mu.RUnlock()

	diskStat, statErr := statFn(mountPath)
	if statErr != nil {
		report.MountStatus = "STAT_ERROR"
		report.Warnings = append(report.Warnings, fmt.Sprintf("Failed to query filesystem metrics at %s: %v", mountPath, statErr))
		return report
	}

	report.DiskStat = diskStat

	if diskStat.IsReadOnly {
		report.MountStatus = "READ_ONLY"
		report.Warnings = append(report.Warnings, "Mount is currently mounted in READ-ONLY mode; mutations will fail")
	} else {
		report.MountStatus = "MOUNTED"
	}

	// Audit volume disk pressure (>85% threshold warning)
	if diskStat.UsedPercent >= p.diskPressureThreshold {
		report.DiskPressure = true
		if diskStat.UsedPercent >= DefaultDiskCriticalThresholdPct {
			report.DiskPressureSeverity = "CRITICAL"
			report.Warnings = append(report.Warnings, fmt.Sprintf("CRITICAL DISK PRESSURE: Volume used space is %.1f%% (exceeds %d%% threshold)", diskStat.UsedPercent, int(DefaultDiskCriticalThresholdPct)))
		} else {
			report.DiskPressureSeverity = "WARNING"
			report.Warnings = append(report.Warnings, fmt.Sprintf("VOLUME DISK PRESSURE: Volume used space is %.1f%% (exceeds %d%% threshold)", diskStat.UsedPercent, int(p.diskPressureThreshold)))
		}
	}

	// Audit inode exhaustion (>85% threshold warning)
	if diskStat.InodesUsedPercent >= DefaultInodePressureThresholdPct {
		report.InodePressure = true
		report.Warnings = append(report.Warnings, fmt.Sprintf("INODE EXHAUSTION WARNING: Inode usage is %.1f%% (exceeds %d%% threshold)", diskStat.InodesUsedPercent, int(DefaultInodePressureThresholdPct)))
	}

	return report
}

// locateVolumeMountPath traverses known kubelet mount roots to find the PVC mount
func (p *PVCInspector) locateVolumeMountPath(volumeName, namespace, pvcName string) (string, bool) {
	if volumeName == "" && pvcName == "" {
		return "", false
	}

	for _, basePath := range p.hostMountBasePaths {
		if _, err := os.Stat(basePath); os.IsNotExist(err) {
			continue
		}

		var candidate string
		_ = filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if !info.IsDir() {
				return nil
			}

			// Check for volumeName or pvcName match in directory path
			if volumeName != "" && strings.Contains(path, volumeName) {
				candidate = path
				return filepath.SkipDir
			}
			if pvcName != "" && strings.Contains(path, pvcName) {
				candidate = path
				return filepath.SkipDir
			}
			return nil
		})

		if candidate != "" {
			return candidate, true
		}
	}

	return "", false
}

// ToTelemetryObservations converts inspection reports into standardized agent ResourceObservations
func (p *PVCInspector) ToTelemetryObservations(reports []PVCInspectionReport, clusterID string) []types.ResourceObservation {
	now := time.Now().UnixMilli()
	nowStr := time.Now().UTC().Format(time.RFC3339)
	observations := make([]types.ResourceObservation, 0, len(reports))

	for _, rep := range reports {
		health := "HEALTHY"
		if rep.DiskPressureSeverity == "CRITICAL" {
			health = "CRITICAL"
		} else if rep.DiskPressure || rep.InodePressure || rep.Phase == "Lost" {
			health = "WARNING"
		}

		specSummary := map[string]interface{}{
			"requestedCapacity": rep.RequestedCapacity,
			"storageClassName":  rep.StorageClassName,
			"accessModes":       rep.AccessModes,
			"volumeName":        rep.VolumeName,
		}

		statusSummary := map[string]interface{}{
			"phase":                rep.Phase,
			"mountStatus":          rep.MountStatus,
			"diskPressure":         rep.DiskPressure,
			"diskPressureSeverity": rep.DiskPressureSeverity,
			"inodePressure":        rep.InodePressure,
			"allocatedCapacity":    rep.AllocatedCapacity,
			"warnings":             rep.Warnings,
		}

		if rep.DiskStat != nil {
			statusSummary["usedPercent"] = rep.DiskStat.UsedPercent
			statusSummary["usedBytes"] = rep.DiskStat.UsedBytes
			statusSummary["totalBytes"] = rep.DiskStat.TotalBytes
			statusSummary["availableBytes"] = rep.DiskStat.AvailableBytes
			statusSummary["inodesUsedPercent"] = rep.DiskStat.InodesUsedPercent
			statusSummary["isReadOnly"] = rep.DiskStat.IsReadOnly
		}

		conditions := make([]types.ConditionStatus, 0)
		if rep.DiskPressure {
			conditions = append(conditions, types.ConditionStatus{
				Type:               "DiskPressure",
				Status:             "True",
				LastTransitionTime: nowStr,
				Reason:             "HighStorageUtilization",
				Message:            fmt.Sprintf("Disk utilization reached %.1f%%", rep.DiskStat.UsedPercent),
			})
		}
		if rep.InodePressure {
			conditions = append(conditions, types.ConditionStatus{
				Type:               "InodePressure",
				Status:             "True",
				LastTransitionTime: nowStr,
				Reason:             "HighInodeUtilization",
				Message:            fmt.Sprintf("Inode utilization reached %.1f%%", rep.DiskStat.InodesUsedPercent),
			})
		}

		obs := types.ResourceObservation{
			ClusterID:     clusterID,
			Kind:          "PersistentVolumeClaim",
			Namespace:     rep.Namespace,
			Name:          rep.Name,
			Status:        rep.Phase,
			Health:        health,
			CreatedAt:     rep.InspectedAt,
			UpdatedAt:     now,
			ObservedAt:    now,
			SpecSummary:   specSummary,
			StatusSummary: statusSummary,
			Conditions:    conditions,
			Labels:        rep.Labels,
		}

		observations = append(observations, obs)
	}

	slog.Debug("Converted PVC inspections to telemetry observations", "count", len(observations))
	return observations
}
