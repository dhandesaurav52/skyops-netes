package observation

import (
	"fmt"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
)

// Detector tracks recent resource states and produces StateChangeRecords upon meaningful deltas
type Detector struct {
	mu           sync.RWMutex
	lastStateMap map[string]*types.ResourceObservation // key: kind/namespace/name or uid
}

func NewDetector() *Detector {
	return &Detector{
		lastStateMap: make(map[string]*types.ResourceObservation),
	}
}

func resourceKey(res *types.ResourceObservation) string {
	if res.ID != "" {
		return res.ID
	}
	return fmt.Sprintf("%s/%s/%s", res.Kind, res.Namespace, res.Name)
}

// DetectChanges evaluates all incoming observations against historical baseline
func (d *Detector) DetectChanges(incoming []types.ResourceObservation) []StateChangeRecord {
	var allChanges []StateChangeRecord
	for i := range incoming {
		changes := d.Evaluate(&incoming[i])
		if len(changes) > 0 {
			allChanges = append(allChanges, changes...)
		}
	}
	return allChanges
}

// StateChangeDelta is an alias for StateChangeRecord
type StateChangeDelta = StateChangeRecord

// Evaluate checks a new resource observation against previous state and returns any detected changes
func (d *Detector) Evaluate(current *types.ResourceObservation) []StateChangeRecord {
	if current == nil {
		return nil
	}

	key := resourceKey(current)

	d.mu.Lock()
	prev, exists := d.lastStateMap[key]
	// Clone current for future comparison
	currCopy := *current
	d.lastStateMap[key] = &currCopy
	d.mu.Unlock()

	if !exists || prev == nil {
		// First time seeing resource: not a change delta, but initial observation
		return nil
	}

	var changes []StateChangeRecord
	now := time.Now().UnixMilli()
	uid := current.ID
	if uid == "" {
		uid = key
	}

	// 1. Overall Health / Status Change
	if prev.Status != current.Status {
		sev := SeverityInfo
		if current.Health == "CRITICAL" {
			sev = SeverityCritical
		} else if current.Health == "WARNING" {
			sev = SeverityWarning
		}
		changes = append(changes, StateChangeRecord{
			ResourceUID: uid,
			Kind:        current.Kind,
			Namespace:   current.Namespace,
			Name:        current.Name,
			ChangeType:  "STATUS_CHANGE",
			Field:       "status",
			OldValue:    prev.Status,
			NewValue:    current.Status,
			Severity:    sev,
			Timestamp:   now,
		})
	}

	// 2. Pod Specific Transitions
	if current.Kind == "Pod" {
		prevContainers := make(map[string]types.ContainerStatus)
		for _, c := range prev.Containers {
			prevContainers[c.Name] = c
		}

		for _, c := range current.Containers {
			pc, hadPrev := prevContainers[c.Name]
			if hadPrev {
				// Restart count increase
				if c.RestartCount > pc.RestartCount {
					changes = append(changes, StateChangeRecord{
						ResourceUID: uid,
						Kind:        current.Kind,
						Namespace:   current.Namespace,
						Name:        current.Name,
						ChangeType:  "RESTART_COUNT_INCREASED",
						Field:       fmt.Sprintf("containers[%s].restartCount", c.Name),
						OldValue:    pc.RestartCount,
						NewValue:    c.RestartCount,
						Severity:    SeverityWarning,
						Timestamp:   now,
						Metadata: map[string]interface{}{
							"container":      c.Name,
							"image":          c.Image,
							"delta":          c.RestartCount - pc.RestartCount,
							"lastExitCode":   c.LastExitCode,
							"waitingReason":  c.WaitingReason,
							"waitingMessage": c.WaitingMessage,
						},
					})
				}

				// Waiting reason change (e.g. CrashLoopBackOff, ImagePullBackOff, ErrImagePull)
				if c.WaitingReason != "" && c.WaitingReason != pc.WaitingReason {
					sev := SeverityWarning
					if c.WaitingReason == "CrashLoopBackOff" || c.WaitingReason == "ImagePullBackOff" {
						sev = SeverityCritical
					}
					changes = append(changes, StateChangeRecord{
						ResourceUID: uid,
						Kind:        current.Kind,
						Namespace:   current.Namespace,
						Name:        current.Name,
						ChangeType:  "CONTAINER_WAITING_REASON",
						Field:       fmt.Sprintf("containers[%s].waitingReason", c.Name),
						OldValue:    pc.WaitingReason,
						NewValue:    c.WaitingReason,
						Severity:    sev,
						Timestamp:   now,
						Metadata: map[string]interface{}{
							"container": c.Name,
							"message":   c.WaitingMessage,
						},
					})
				}

				// Readiness change
				if c.Ready != pc.Ready {
					changes = append(changes, StateChangeRecord{
						ResourceUID: uid,
						Kind:        current.Kind,
						Namespace:   current.Namespace,
						Name:        current.Name,
						ChangeType:  "CONTAINER_READINESS",
						Field:       fmt.Sprintf("containers[%s].ready", c.Name),
						OldValue:    pc.Ready,
						NewValue:    c.Ready,
						Severity:    SeverityInfo,
						Timestamp:   now,
						Metadata: map[string]interface{}{
							"container": c.Name,
						},
					})
				}
			}
		}
	}

	// 3. Node Ready Condition Change
	if current.Kind == "Node" {
		prevReady := ""
		for _, cond := range prev.Conditions {
			if cond.Type == "Ready" {
				prevReady = cond.Status
				break
			}
		}

		currReady := ""
		for _, cond := range current.Conditions {
			if cond.Type == "Ready" {
				currReady = cond.Status
				break
			}
		}

		if prevReady != "" && currReady != "" && prevReady != currReady {
			sev := SeverityInfo
			if currReady != "True" {
				sev = SeverityCritical
			}
			changes = append(changes, StateChangeRecord{
				ResourceUID: uid,
				Kind:        current.Kind,
				Namespace:   current.Namespace,
				Name:        current.Name,
				ChangeType:  "NODE_READY_TRANSITION",
				Field:       "conditions[Ready].status",
				OldValue:    prevReady,
				NewValue:    currReady,
				Severity:    sev,
				Timestamp:   now,
			})
		}

		// Node pressure conditions: MemoryPressure, DiskPressure, PIDPressure
		for _, c := range current.Conditions {
			if (c.Type == "MemoryPressure" || c.Type == "DiskPressure" || c.Type == "PIDPressure") && c.Status == "True" {
				// Check if previous had pressure
				prevPress := false
				for _, pc := range prev.Conditions {
					if pc.Type == c.Type && pc.Status == "True" {
						prevPress = true
						break
					}
				}
				if !prevPress {
					changes = append(changes, StateChangeRecord{
						ResourceUID: uid,
						Kind:        current.Kind,
						Namespace:   current.Namespace,
						Name:        current.Name,
						ChangeType:  "NODE_PRESSURE_DETECTED",
						Field:       fmt.Sprintf("conditions[%s]", c.Type),
						OldValue:    "False",
						NewValue:    "True",
						Severity:    SeverityWarning,
						Timestamp:   now,
						Metadata: map[string]interface{}{
							"condition": c.Type,
							"reason":    c.Reason,
							"message":   c.Message,
						},
					})
				}
			}
		}
	}

	return changes
}

// Clear removes state on full resync or restart
func (d *Detector) Clear() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lastStateMap = make(map[string]*types.ResourceObservation)
}
