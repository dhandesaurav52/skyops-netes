package observation

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/skyops-io/skyops/agent/internal/types"
)

// ObservationType classifies the event or telemetry entry
type ObservationType string

const (
	TypeSnapshot       ObservationType = "SNAPSHOT"
	TypeAdd            ObservationType = "ADD"
	TypeUpdate         ObservationType = "UPDATE"
	TypeDelete         ObservationType = "DELETE"
	TypeEvent          ObservationType = "EVENT"
	TypeMetric         ObservationType = "METRIC"
	TypeStateChange    ObservationType = "STATE_CHANGE"
	TypeIncidentSignal ObservationType = "INCIDENT_SIGNAL"
)

// Severity categorizes operational urgency
type Severity string

const (
	SeverityInfo     Severity = "INFO"
	SeverityWarning  Severity = "WARNING"
	SeverityCritical Severity = "CRITICAL"
)

// Relationship models typed directional connection between cluster resources
type Relationship struct {
	Type        string `json:"type"` // e.g. "OWNS", "SELECTS", "ROUTES_TO", "MOUNTS", "BOUND_TO", "SCHEDULED_ON"
	TargetKind  string `json:"targetKind"`
	TargetNS    string `json:"targetNamespace,omitempty"`
	TargetName  string `json:"targetName"`
	TargetUID   string `json:"targetUid,omitempty"`
}

// CanonicalObservation models the unified, immutable fact about a cluster entity
type CanonicalObservation struct {
	SchemaVersion   string                 `json:"schemaVersion"`
	ObservationID   string                 `json:"observationId"`
	ClusterID       string                 `json:"clusterId"`
	AgentID         string                 `json:"agentId"`
	ResourceUID     string                 `json:"resourceUid"`
	Kind            string                 `json:"kind"`
	Namespace       string                 `json:"namespace"`
	Name            string                 `json:"name"`
	ResourceVersion string                 `json:"resourceVersion,omitempty"`
	Type            ObservationType        `json:"type"`
	Severity        Severity               `json:"severity"`
	Timestamp       int64                  `json:"timestamp"`
	Facts           map[string]interface{} `json:"facts,omitempty"`
	Relationships   []Relationship         `json:"relationships,omitempty"`
	Payload         types.ResourceObservation `json:"payload"`
}

// NewCanonical creates a new observation with generated ID and schema version
func NewCanonical(
	clusterID, agentID, resourceUID, kind, namespace, name, resVer string,
	obsType ObservationType,
	sev Severity,
	payload types.ResourceObservation,
) *CanonicalObservation {
	obsID := uuid.New().String()
	if resourceUID == "" {
		resourceUID = fmt.Sprintf("%s-%s-%s-%s", clusterID, kind, namespace, name)
	}

	return &CanonicalObservation{
		SchemaVersion:   "1.0",
		ObservationID:   obsID,
		ClusterID:       clusterID,
		AgentID:         agentID,
		ResourceUID:     resourceUID,
		Kind:            kind,
		Namespace:       namespace,
		Name:            name,
		ResourceVersion: resVer,
		Type:            obsType,
		Severity:        sev,
		Timestamp:       time.Now().UnixMilli(),
		Facts:           make(map[string]interface{}),
		Relationships:   nil,
		Payload:         payload,
	}
}

// StateChangeRecord details what specifically transitioned
type StateChangeRecord struct {
	ResourceUID   string                 `json:"resourceUid"`
	Kind          string                 `json:"kind"`
	Namespace     string                 `json:"namespace"`
	Name          string                 `json:"name"`
	ChangeType    string                 `json:"changeType"`
	Field         string                 `json:"field"`
	OldValue      interface{}            `json:"oldValue"`
	NewValue      interface{}            `json:"newValue"`
	Severity      Severity               `json:"severity"`
	Timestamp     int64                  `json:"timestamp"`
	CorrelatedFacts map[string]interface{} `json:"correlatedFacts,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}
