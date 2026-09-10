package collector

// ResourceObservation represents a monitored Kubernetes resource with full provenance and metadata
type ResourceObservation struct {
	ID              string                 `json:"id,omitempty"`
	ClusterID       string                 `json:"clusterId,omitempty"`
	Kind            string                 `json:"kind"`
	Namespace       string                 `json:"namespace"`
	Name            string                 `json:"name"`
	NodeName        string                 `json:"nodeName,omitempty"`
	Status          string                 `json:"status"`
	Health          string                 `json:"health"`
	CreatedAt       int64                  `json:"createdAt"`
	UpdatedAt       int64                  `json:"updatedAt"`
	ObservedAt      int64                  `json:"observedAt,omitempty"`
	SpecSummary     map[string]interface{} `json:"specSummary"`
	StatusSummary   map[string]interface{} `json:"statusSummary"`
	Containers      []ContainerStatus      `json:"containers,omitempty"`
	Conditions      []ConditionStatus      `json:"conditions,omitempty"`
	Events          []EventObservation     `json:"events,omitempty"`
	OwnerReferences []OwnerReference       `json:"ownerReferences,omitempty"`
	Labels          map[string]string      `json:"labels,omitempty"`
	Annotations     map[string]string      `json:"annotations,omitempty"`
}

// OwnerReference tracks parent controllers and workloads
type OwnerReference struct {
	APIVersion string `json:"apiVersion,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Name       string `json:"name,omitempty"`
	UID        string `json:"uid,omitempty"`
	Controller bool   `json:"controller,omitempty"`
}

// ContainerStatus provides deep runtime diagnostic details for a container
type ContainerStatus struct {
	Name                  string         `json:"name"`
	Image                 string         `json:"image"`
	RestartCount          int            `json:"restartCount"`
	Ready                 bool           `json:"ready"`
	State                 string         `json:"state"`
	WaitingReason         string         `json:"waitingReason,omitempty"`
	WaitingMessage        string         `json:"waitingMessage,omitempty"`
	TerminationReason     string         `json:"terminationReason,omitempty"`
	ExitCode              int            `json:"exitCode,omitempty"`
	LastTerminationReason string         `json:"lastTerminationReason,omitempty"`
	LastExitCode          int            `json:"lastExitCode,omitempty"`
	MemoryLimit           string         `json:"memoryLimit,omitempty"`
	MemoryRequest         string         `json:"memoryRequest,omitempty"`
	CpuLimit              string         `json:"cpuLimit,omitempty"`
	CpuRequest            string         `json:"cpuRequest,omitempty"`
	MemoryUsage           string         `json:"memoryUsage,omitempty"`
	CpuUsage              string         `json:"cpuUsage,omitempty"`
	Probes                *ProbesSummary `json:"probes,omitempty"`
}

// ProbesSummary holds probe configurations for readiness, liveness, and startup
type ProbesSummary struct {
	Liveness  *ProbeInfo `json:"liveness,omitempty"`
	Readiness *ProbeInfo `json:"readiness,omitempty"`
	Startup   *ProbeInfo `json:"startup,omitempty"`
}

// ProbeInfo details probe execution parameters
type ProbeInfo struct {
	Type                string `json:"type,omitempty"` // "httpGet", "exec", "tcpSocket", "grpc"
	Path                string `json:"path,omitempty"`
	Port                string `json:"port,omitempty"`
	InitialDelaySeconds int32  `json:"initialDelaySeconds,omitempty"`
	PeriodSeconds       int32  `json:"periodSeconds,omitempty"`
	TimeoutSeconds      int32  `json:"timeoutSeconds,omitempty"`
	FailureThreshold    int32  `json:"failureThreshold,omitempty"`
	SuccessThreshold    int32  `json:"successThreshold,omitempty"`
}

// ConditionStatus provides diagnostic condition state
type ConditionStatus struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

// EventObservation captures an active or historical Kubernetes event
type EventObservation struct {
	ID         string `json:"id"`
	Timestamp  int64  `json:"timestamp"`
	Type       string `json:"type"`
	Reason     string `json:"reason"`
	ObjectKind string `json:"objectKind"`
	ObjectName string `json:"objectName"`
	Namespace  string `json:"namespace"`
	Message    string `json:"message"`
}

// CollectionStatusItem records freshness, success, count, and error reasons per resource kind
type CollectionStatusItem struct {
	Success    bool   `json:"success"`
	Count      int    `json:"count"`
	ObservedAt int64  `json:"observedAt"`
	Error      string `json:"error,omitempty"`
	StatusCode int    `json:"statusCode,omitempty"`
}

// TelemetryBatch represents the full telemetry payload transmitted to the SkyOps central platform
type TelemetryBatch struct {
	ClusterID        string                          `json:"clusterId"`
	Timestamp        int64                           `json:"timestamp"`
	ObservedAt       int64                           `json:"observedAt"`
	TransmittedAt    int64                           `json:"transmittedAt"`
	Items            []interface{}                   `json:"items"`
	CollectionStatus map[string]CollectionStatusItem `json:"collectionStatus"`
	SnapshotComplete bool                            `json:"snapshotComplete"`
}
