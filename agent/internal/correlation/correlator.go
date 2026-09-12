package correlation

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/skyops-io/skyops/agent/internal/graph"
	"github.com/skyops-io/skyops/agent/internal/types"
)

// IncidentSignal represents deterministic, correlated evidence of an active operational degradation
type IncidentSignal struct {
	SignalID         string                   `json:"signalId"`
	Type             string                   `json:"type"` // "OOM_KILLED", "CRASH_LOOP", "IMAGE_PULL_FAILED", "NODE_DEGRADED", "REPLICA_UNAVAILABLE"
	Severity         string                   `json:"severity"` // "CRITICAL", "WARNING", "INFO"
	PrimaryKind      string                   `json:"primaryKind"`
	PrimaryNS        string                   `json:"primaryNamespace"`
	PrimaryName      string                   `json:"primaryName"`
	PrimaryUID       string                   `json:"primaryUid,omitempty"`
	RootWorkload     string                   `json:"rootWorkload,omitempty"` // e.g. "Deployment/api-server"
	Summary          string                   `json:"summary"`
	Facts            map[string]interface{}   `json:"facts"`
	CorrelatedEvents []types.EventObservation `json:"correlatedEvents,omitempty"`
	Timestamp        int64                    `json:"timestamp"`
}

// Correlator analyzes cluster observations, events, and relationship graph to emit deterministic incident signals
type Correlator struct {
	graph *graph.Graph
}

func NewCorrelator(g *graph.Graph) *Correlator {
	return &Correlator{graph: g}
}

func (c *Correlator) Correlate(resources []types.ResourceObservation, events []types.EventObservation) []IncidentSignal {
	var signals []IncidentSignal
	now := time.Now().UnixMilli()

	// Index events by "Kind/Namespace/Name"
	eventMap := make(map[string][]types.EventObservation)
	for _, ev := range events {
		key := fmt.Sprintf("%s/%s/%s", ev.ObjectKind, ev.Namespace, ev.ObjectName)
		eventMap[key] = append(eventMap[key], ev)
	}

	for _, res := range resources {
		objKey := fmt.Sprintf("%s/%s/%s", res.Kind, res.Namespace, res.Name)
		objEvents := eventMap[objKey]

		// 1. Pod Correlations
		if res.Kind == "Pod" {
			var rootWorkload string
			if c.graph != nil {
				rk, rn := c.graph.FindRootWorkload(res.Namespace, res.Name)
				if rk != "" {
					rootWorkload = fmt.Sprintf("%s/%s", rk, rn)
				}
			}

			for _, container := range res.Containers {
				// OOMKilled signal
				if container.LastTerminationReason == "OOMKilled" || container.TerminationReason == "OOMKilled" {
					facts := map[string]interface{}{
						"container":     container.Name,
						"image":         container.Image,
						"exitCode":      137,
						"restartCount":  container.RestartCount,
						"memoryLimit":   container.MemoryLimit,
						"memoryRequest": container.MemoryRequest,
						"node":          res.NodeName,
					}
					signals = append(signals, IncidentSignal{
						SignalID:         uuid.New().String(),
						Type:             "OOM_KILLED",
						Severity:         "CRITICAL",
						PrimaryKind:      "Pod",
						PrimaryNS:        res.Namespace,
						PrimaryName:      res.Name,
						PrimaryUID:       res.ID,
						RootWorkload:     rootWorkload,
						Summary:          fmt.Sprintf("Container %q in Pod %s/%s was OOMKilled (ExitCode: 137, Restarts: %d)", container.Name, res.Namespace, res.Name, container.RestartCount),
						Facts:            facts,
						CorrelatedEvents: objEvents,
						Timestamp:        now,
					})
				}

				// CrashLoopBackOff signal
				if container.WaitingReason == "CrashLoopBackOff" {
					facts := map[string]interface{}{
						"container":             container.Name,
						"image":                 container.Image,
						"restartCount":          container.RestartCount,
						"waitingMessage":        container.WaitingMessage,
						"lastTerminationReason": container.LastTerminationReason,
						"lastExitCode":          container.LastExitCode,
						"node":                  res.NodeName,
					}
					signals = append(signals, IncidentSignal{
						SignalID:         uuid.New().String(),
						Type:             "CRASH_LOOP",
						Severity:         "CRITICAL",
						PrimaryKind:      "Pod",
						PrimaryNS:        res.Namespace,
						PrimaryName:      res.Name,
						PrimaryUID:       res.ID,
						RootWorkload:     rootWorkload,
						Summary:          fmt.Sprintf("Container %q in Pod %s/%s is failing with CrashLoopBackOff (Restarts: %d)", container.Name, res.Namespace, res.Name, container.RestartCount),
						Facts:            facts,
						CorrelatedEvents: objEvents,
						Timestamp:        now,
					})
				}

				// ImagePullBackOff / ErrImagePull signal
				if container.WaitingReason == "ImagePullBackOff" || container.WaitingReason == "ErrImagePull" {
					facts := map[string]interface{}{
						"container":      container.Name,
						"image":          container.Image,
						"waitingReason":  container.WaitingReason,
						"waitingMessage": container.WaitingMessage,
					}
					signals = append(signals, IncidentSignal{
						SignalID:         uuid.New().String(),
						Type:             "IMAGE_PULL_FAILED",
						Severity:         "CRITICAL",
						PrimaryKind:      "Pod",
						PrimaryNS:        res.Namespace,
						PrimaryName:      res.Name,
						PrimaryUID:       res.ID,
						RootWorkload:     rootWorkload,
						Summary:          fmt.Sprintf("Image pull failed for container %q (Image: %s)", container.Name, container.Image),
						Facts:            facts,
						CorrelatedEvents: objEvents,
						Timestamp:        now,
					})
				}
			}
		}

		// 2. Node Degradation
		if res.Kind == "Node" {
			for _, cond := range res.Conditions {
				if cond.Type == "Ready" && cond.Status != "True" {
					signals = append(signals, IncidentSignal{
						SignalID:    uuid.New().String(),
						Type:        "NODE_NOT_READY",
						Severity:    "CRITICAL",
						PrimaryKind: "Node",
						PrimaryNS:   "",
						PrimaryName: res.Name,
						PrimaryUID:  res.ID,
						Summary:     fmt.Sprintf("Node %s is NotReady: %s", res.Name, cond.Message),
						Facts: map[string]interface{}{
							"condition": cond.Type,
							"status":    cond.Status,
							"reason":    cond.Reason,
							"message":   cond.Message,
						},
						CorrelatedEvents: objEvents,
						Timestamp:        now,
					})
				} else if (cond.Type == "MemoryPressure" || cond.Type == "DiskPressure" || cond.Type == "PIDPressure") && cond.Status == "True" {
					signals = append(signals, IncidentSignal{
						SignalID:    uuid.New().String(),
						Type:        "NODE_PRESSURE",
						Severity:    "WARNING",
						PrimaryKind: "Node",
						PrimaryNS:   "",
						PrimaryName: res.Name,
						PrimaryUID:  res.ID,
						Summary:     fmt.Sprintf("Node %s is under %s: %s", res.Name, cond.Type, cond.Message),
						Facts: map[string]interface{}{
							"pressureType": cond.Type,
							"reason":       cond.Reason,
							"message":      cond.Message,
						},
						CorrelatedEvents: objEvents,
						Timestamp:        now,
					})
				}
			}
		}

		// 3. Deployment Replica Availability
		if res.Kind == "Deployment" && res.Health == "CRITICAL" {
			signals = append(signals, IncidentSignal{
				SignalID:     uuid.New().String(),
				Type:         "REPLICA_UNAVAILABLE",
				Severity:     "CRITICAL",
				PrimaryKind:  "Deployment",
				PrimaryNS:    res.Namespace,
				PrimaryName:  res.Name,
				PrimaryUID:   res.ID,
				RootWorkload: fmt.Sprintf("Deployment/%s", res.Name),
				Summary:      fmt.Sprintf("Deployment %s/%s has 0 ready replicas", res.Namespace, res.Name),
				Facts: map[string]interface{}{
					"statusSummary": res.StatusSummary,
					"specSummary":   res.SpecSummary,
				},
				CorrelatedEvents: objEvents,
				Timestamp:        now,
			})
		}
	}

	// De-duplicate signals by primary entity + type
	uniqueSignals := make([]IncidentSignal, 0, len(signals))
	seen := make(map[string]bool)
	for _, s := range signals {
		key := fmt.Sprintf("%s:%s:%s:%s", s.Type, s.PrimaryKind, s.PrimaryNS, s.PrimaryName)
		if !seen[key] {
			seen[key] = true
			uniqueSignals = append(uniqueSignals, s)
		}
	}

	return uniqueSignals
}

// FindEventsForResource returns events referencing a specific resource
func FindEventsForResource(events []types.EventObservation, kind, ns, name string) []types.EventObservation {
	var matching []types.EventObservation
	for _, ev := range events {
		if strings.EqualFold(ev.ObjectKind, kind) && ev.Namespace == ns && ev.ObjectName == name {
			matching = append(matching, ev)
		}
	}
	return matching
}
