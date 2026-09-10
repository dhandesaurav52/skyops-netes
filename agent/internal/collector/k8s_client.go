package collector

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// InClusterK8sClient performs in-cluster Kubernetes API calls using the mounted ServiceAccount token and CA cert
type InClusterK8sClient struct {
	httpClient *http.Client
	apiBaseURL string
	token      string
}

func NewInClusterK8sClient() (*InClusterK8sClient, error) {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		host = "kubernetes.default.svc"
		port = "443"
	}

	tokenBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return nil, fmt.Errorf("unable to read serviceaccount token: %w", err)
	}

	caCertPool, _ := x509.SystemCertPool()
	if caCertPool == nil {
		caCertPool = x509.NewCertPool()
	}
	caCertBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err == nil && len(caCertBytes) > 0 {
		caCertPool.AppendCertsFromPEM(caCertBytes)
	}

	insecureSkip := os.Getenv("KUBERNETES_INSECURE_SKIP_TLS_VERIFY") == "true"

	tlsConfig := &tls.Config{
		RootCAs:            caCertPool,
		InsecureSkipVerify: insecureSkip,
	}

	transport := &http.Transport{
		TLSClientConfig: tlsConfig,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   20 * time.Second,
	}

	baseURL := fmt.Sprintf("https://%s:%s", host, port)

	return &InClusterK8sClient{
		httpClient: client,
		apiBaseURL: baseURL,
		token:      strings.TrimSpace(string(tokenBytes)),
	}, nil
}

// NewCustomK8sClient creates a client with custom HTTP client, baseURL, and token (useful for testing or custom configs)
func NewCustomK8sClient(httpClient *http.Client, baseURL, token string) *InClusterK8sClient {
	return &InClusterK8sClient{
		httpClient: httpClient,
		apiBaseURL: strings.TrimRight(baseURL, "/"),
		token:      strings.TrimSpace(token),
	}
}

func (k *InClusterK8sClient) GetJSON(ctx context.Context, apiPath string, target interface{}) error {
	_, err := k.GetJSONWithStatus(ctx, apiPath, target)
	return err
}

// GetJSONWithStatus executes a GET request and returns the HTTP status code and any error encountered
func (k *InClusterK8sClient) GetJSONWithStatus(ctx context.Context, apiPath string, target interface{}) (int, error) {
	url := fmt.Sprintf("%s%s", k.apiBaseURL, apiPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}

	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Accept", "application/json")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, fmt.Errorf("kubernetes API GET %s returned HTTP %d: %s", apiPath, resp.StatusCode, string(body))
	}

	if target != nil {
		if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
			return resp.StatusCode, err
		}
	}

	return http.StatusOK, nil
}

// K8sVersionInfo represents the response from /version
type K8sVersionInfo struct {
	Major        string `json:"major"`
	Minor        string `json:"minor"`
	GitVersion   string `json:"gitVersion"`
	GitCommit    string `json:"gitCommit"`
	GitTreeState string `json:"gitTreeState"`
	BuildDate    string `json:"buildDate"`
	GoVersion    string `json:"goVersion"`
	Compiler     string `json:"compiler"`
	Platform     string `json:"platform"`
}

// GetServerVersion queries /version to discover the live Kubernetes version
func (k *InClusterK8sClient) GetServerVersion(ctx context.Context) (string, error) {
	var verInfo K8sVersionInfo
	if err := k.GetJSON(ctx, "/version", &verInfo); err != nil {
		return "", err
	}
	if verInfo.GitVersion != "" {
		return verInfo.GitVersion, nil
	}
	if verInfo.Major != "" && verInfo.Minor != "" {
		return fmt.Sprintf("v%s.%s", verInfo.Major, verInfo.Minor), nil
	}
	return "", fmt.Errorf("no version string found in /version response")
}

// K8sNodeMetricsList represents the response from /apis/metrics.k8s.io/v1beta1/nodes
type K8sNodeMetricsList struct {
	Items []K8sNodeMetrics `json:"items"`
}

type K8sNodeMetrics struct {
	Metadata  K8sObjectMeta     `json:"metadata"`
	Timestamp string            `json:"timestamp"`
	Window    string            `json:"window"`
	Usage     map[string]string `json:"usage"` // "cpu", "memory"
}

// K8sPodMetricsList represents the response from /apis/metrics.k8s.io/v1beta1/pods
type K8sPodMetricsList struct {
	Items []K8sPodMetrics `json:"items"`
}

type K8sPodMetrics struct {
	Metadata   K8sObjectMeta `json:"metadata"`
	Timestamp  string        `json:"timestamp"`
	Window     string        `json:"window"`
	Containers []struct {
		Name  string            `json:"name"`
		Usage map[string]string `json:"usage"`
	} `json:"containers"`
}

// GetNodeMetrics queries the Metrics Server API /apis/metrics.k8s.io/v1beta1/nodes
func (k *InClusterK8sClient) GetNodeMetrics(ctx context.Context) (*K8sNodeMetricsList, error) {
	var metricsList K8sNodeMetricsList
	if err := k.GetJSON(ctx, "/apis/metrics.k8s.io/v1beta1/nodes", &metricsList); err != nil {
		return nil, err
	}
	return &metricsList, nil
}

// GetPodMetrics queries the Metrics Server API /apis/metrics.k8s.io/v1beta1/pods
func (k *InClusterK8sClient) GetPodMetrics(ctx context.Context) (*K8sPodMetricsList, error) {
	var metricsList K8sPodMetricsList
	if err := k.GetJSON(ctx, "/apis/metrics.k8s.io/v1beta1/pods", &metricsList); err != nil {
		return nil, err
	}
	return &metricsList, nil
}

// Low-level K8s object schemas
type K8sListMeta struct {
	ResourceVersion string `json:"resourceVersion"`
}

type K8sObjectMeta struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	UID               string            `json:"uid"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Labels            map[string]string `json:"labels"`
	Annotations       map[string]string `json:"annotations"`
	OwnerReferences   []struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		UID        string `json:"uid"`
		Controller *bool  `json:"controller"`
	} `json:"ownerReferences"`
}

type K8sNodeList struct {
	Items []K8sNode `json:"items"`
}

type K8sNode struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		PodCIDR string `json:"podCIDR"`
		Taints  []struct {
			Key    string `json:"key"`
			Value  string `json:"value"`
			Effect string `json:"effect"`
		} `json:"taints"`
	} `json:"spec"`
	Status struct {
		Capacity    map[string]string `json:"capacity"`
		Allocatable map[string]string `json:"allocatable"`
		NodeInfo    struct {
			KubeletVersion          string `json:"kubeletVersion"`
			OSImage                 string `json:"osImage"`
			Architecture            string `json:"architecture"`
			ContainerRuntimeVersion string `json:"containerRuntimeVersion"`
		} `json:"nodeInfo"`
		Conditions []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
	} `json:"status"`
}

type K8sProbe struct {
	HTTPGet *struct {
		Path   string      `json:"path"`
		Port   interface{} `json:"port"`
		Scheme string      `json:"scheme"`
	} `json:"httpGet"`
	TCPSocket *struct {
		Port interface{} `json:"port"`
	} `json:"tcpSocket"`
	Exec *struct {
		Command []string `json:"command"`
	} `json:"exec"`
	GRPC *struct {
		Port    int32   `json:"port"`
		Service *string `json:"service"`
	} `json:"grpc"`
	InitialDelaySeconds int32 `json:"initialDelaySeconds"`
	TimeoutSeconds      int32 `json:"timeoutSeconds"`
	PeriodSeconds       int32 `json:"periodSeconds"`
	SuccessThreshold    int32 `json:"successThreshold"`
	FailureThreshold    int32 `json:"failureThreshold"`
}

type K8sToleration struct {
	Key               string `json:"key"`
	Operator          string `json:"operator"`
	Value             string `json:"value"`
	Effect            string `json:"effect"`
	TolerationSeconds *int64 `json:"tolerationSeconds"`
}

type K8sPodList struct {
	Items []K8sPod `json:"items"`
}

type K8sPod struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		NodeName           string            `json:"nodeName"`
		NodeSelector       map[string]string `json:"nodeSelector"`
		Tolerations        []K8sToleration   `json:"tolerations"`
		Affinity           interface{}       `json:"affinity"`
		PriorityClassName  string            `json:"priorityClassName"`
		RestartPolicy      string            `json:"restartPolicy"`
		ServiceAccountName string            `json:"serviceAccountName"`
		Containers         []struct {
			Name           string    `json:"name"`
			Image          string    `json:"image"`
			LivenessProbe  *K8sProbe `json:"livenessProbe"`
			ReadinessProbe *K8sProbe `json:"readinessProbe"`
			StartupProbe   *K8sProbe `json:"startupProbe"`
			Resources      struct {
				Requests map[string]string `json:"requests"`
				Limits   map[string]string `json:"limits"`
			} `json:"resources"`
		} `json:"containers"`
	} `json:"spec"`
	Status struct {
		Phase             string `json:"phase"`
		PodIP             string `json:"podIP"`
		HostIP            string `json:"hostIP"`
		StartTime         string `json:"startTime"`
		QOSClass          string `json:"qosClass"`
		NominatedNodeName string `json:"nominatedNodeName"`
		Conditions        []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
		ContainerStatuses []struct {
			Name         string `json:"name"`
			Image        string `json:"image"`
			Ready        bool   `json:"ready"`
			RestartCount int    `json:"restartCount"`
			State        struct {
				Waiting *struct {
					Reason  string `json:"reason"`
					Message string `json:"message"`
				} `json:"waiting"`
				Running *struct {
					StartedAt string `json:"startedAt"`
				} `json:"running"`
				Terminated *struct {
					ExitCode int    `json:"exitCode"`
					Reason   string `json:"reason"`
					Message  string `json:"message"`
				} `json:"terminated"`
			} `json:"state"`
			LastState struct {
				Terminated *struct {
					ExitCode int    `json:"exitCode"`
					Reason   string `json:"reason"`
				} `json:"terminated"`
			} `json:"lastState"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

type K8sDeploymentList struct {
	Items []K8sDeployment `json:"items"`
}

type K8sDeployment struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Replicas int `json:"replicas"`
	} `json:"spec"`
	Status struct {
		Replicas            int `json:"replicas"`
		ReadyReplicas       int `json:"readyReplicas"`
		AvailableReplicas   int `json:"availableReplicas"`
		UpdatedReplicas     int `json:"updatedReplicas"`
		UnavailableReplicas int `json:"unavailableReplicas"`
		Conditions          []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
	} `json:"status"`
}

type K8sStatefulSetList struct {
	Items []K8sStatefulSet `json:"items"`
}

type K8sStatefulSet struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Replicas int `json:"replicas"`
	} `json:"spec"`
	Status struct {
		Replicas        int `json:"replicas"`
		ReadyReplicas   int `json:"readyReplicas"`
		CurrentReplicas int `json:"currentReplicas"`
		UpdatedReplicas int `json:"updatedReplicas"`
	} `json:"status"`
}

type K8sDaemonSetList struct {
	Items []K8sDaemonSet `json:"items"`
}

type K8sDaemonSet struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Status   struct {
		DesiredNumberScheduled int `json:"desiredNumberScheduled"`
		CurrentNumberScheduled int `json:"currentNumberScheduled"`
		NumberReady            int `json:"numberReady"`
		NumberAvailable        int `json:"numberAvailable"`
		NumberMisscheduled     int `json:"numberMisscheduled"`
	} `json:"status"`
}

type K8sPVCList struct {
	Items []K8sPVC `json:"items"`
}

type K8sPVC struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		StorageClassName string   `json:"storageClassName"`
		VolumeName       string   `json:"volumeName"`
		AccessModes      []string `json:"accessModes"`
		Resources        struct {
			Requests map[string]string `json:"requests"`
		} `json:"resources"`
	} `json:"spec"`
	Status struct {
		Phase    string            `json:"phase"`
		Capacity map[string]string `json:"capacity"`
	} `json:"status"`
}

type K8sEventList struct {
	Items []K8sEvent `json:"items"`
}

type K8sEvent struct {
	Metadata       K8sObjectMeta `json:"metadata"`
	InvolvedObject struct {
		Kind      string `json:"kind"`
		Namespace string `json:"namespace"`
		Name      string `json:"name"`
		UID       string `json:"uid"`
	} `json:"involvedObject"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
	Type           string `json:"type"`
	Count          int    `json:"count"`
	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`
	EventTime      string `json:"eventTime"`
}

// Networking: Services, Ingresses, Endpoints
type K8sServiceList struct {
	Items []K8sService `json:"items"`
}

type K8sService struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Type                  string            `json:"type"`
		ClusterIP             string            `json:"clusterIP"`
		ClusterIPs            []string          `json:"clusterIPs"`
		Selector              map[string]string `json:"selector"`
		SessionAffinity       string            `json:"sessionAffinity"`
		ExternalTrafficPolicy string            `json:"externalTrafficPolicy"`
		Ports                 []struct {
			Name        string      `json:"name"`
			Protocol    string      `json:"protocol"`
			Port        int32       `json:"port"`
			TargetPort  interface{} `json:"targetPort"`
			NodePort    int32       `json:"nodePort"`
			AppProtocol *string     `json:"appProtocol"`
		} `json:"ports"`
	} `json:"spec"`
	Status struct {
		LoadBalancer struct {
			Ingress []struct {
				IP       string `json:"ip"`
				Hostname string `json:"hostname"`
			} `json:"ingress"`
		} `json:"loadBalancer"`
	} `json:"status"`
}

type K8sIngressList struct {
	Items []K8sIngress `json:"items"`
}

type K8sIngress struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		IngressClassName *string `json:"ingressClassName"`
		Rules            []struct {
			Host string `json:"host"`
			HTTP *struct {
				Paths []struct {
					Path     string `json:"path"`
					PathType string `json:"pathType"`
					Backend  struct {
						Service *struct {
							Name string `json:"name"`
							Port struct {
								Number int32  `json:"number"`
								Name   string `json:"name"`
							} `json:"port"`
						} `json:"service"`
					} `json:"backend"`
				} `json:"paths"`
			} `json:"http"`
		} `json:"rules"`
		TLS []struct {
			Hosts      []string `json:"hosts"`
			SecretName string   `json:"secretName"`
		} `json:"tls"`
	} `json:"spec"`
	Status struct {
		LoadBalancer struct {
			Ingress []struct {
				IP       string `json:"ip"`
				Hostname string `json:"hostname"`
			} `json:"ingress"`
		} `json:"loadBalancer"`
	} `json:"status"`
}

type K8sEndpointsList struct {
	Items []K8sEndpoints `json:"items"`
}

type K8sEndpoints struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Subsets  []struct {
		Addresses []struct {
			IP        string `json:"ip"`
			Hostname  string `json:"hostname"`
			NodeName  string `json:"nodeName"`
			TargetRef *struct {
				Kind      string `json:"kind"`
				Namespace string `json:"namespace"`
				Name      string `json:"name"`
			} `json:"targetRef"`
		} `json:"addresses"`
		NotReadyAddresses []struct {
			IP        string `json:"ip"`
			Hostname  string `json:"hostname"`
			NodeName  string `json:"nodeName"`
			TargetRef *struct {
				Kind      string `json:"kind"`
				Namespace string `json:"namespace"`
				Name      string `json:"name"`
			} `json:"targetRef"`
		} `json:"notReadyAddresses"`
		Ports []struct {
			Name     string `json:"name"`
			Port     int32  `json:"port"`
			Protocol string `json:"protocol"`
		} `json:"ports"`
	} `json:"subsets"`
}

// EndpointSlices (discovery.k8s.io/v1)
type K8sEndpointSliceList struct {
	Items []K8sEndpointSlice `json:"items"`
}

type K8sEndpointSlice struct {
	Metadata    K8sObjectMeta `json:"metadata"`
	AddressType string        `json:"addressType"`
	Endpoints   []struct {
		Addresses  []string `json:"addresses"`
		Conditions struct {
			Ready       *bool `json:"ready"`
			Serving     *bool `json:"serving"`
			Terminating *bool `json:"terminating"`
		} `json:"conditions"`
		Hostname  *string `json:"hostname"`
		NodeName  *string `json:"nodeName"`
		TargetRef *struct {
			Kind      string `json:"kind"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
			UID       string `json:"uid"`
		} `json:"targetRef"`
	} `json:"endpoints"`
	Ports []struct {
		Name        *string `json:"name"`
		Port        *int32  `json:"port"`
		Protocol    *string `json:"protocol"`
		AppProtocol *string `json:"appProtocol"`
	} `json:"ports"`
}

// Storage: PersistentVolumes, StorageClasses
type K8sPersistentVolumeList struct {
	Items []K8sPersistentVolume `json:"items"`
}

type K8sPersistentVolume struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Capacity                      map[string]string `json:"capacity"`
		AccessModes                   []string          `json:"accessModes"`
		PersistentVolumeReclaimPolicy string            `json:"persistentVolumeReclaimPolicy"`
		StorageClassName              string            `json:"storageClassName"`
		VolumeMode                    string            `json:"volumeMode"`
		ClaimRef                      *struct {
			Kind      string `json:"kind"`
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
			UID       string `json:"uid"`
		} `json:"claimRef"`
	} `json:"spec"`
	Status struct {
		Phase   string `json:"phase"`
		Message string `json:"message"`
		Reason  string `json:"reason"`
	} `json:"status"`
}

type K8sStorageClassList struct {
	Items []K8sStorageClass `json:"items"`
}

type K8sStorageClass struct {
	Metadata             K8sObjectMeta     `json:"metadata"`
	Provisioner          string            `json:"provisioner"`
	ReclaimPolicy        *string           `json:"reclaimPolicy"`
	VolumeBindingMode    *string           `json:"volumeBindingMode"`
	AllowVolumeExpansion *bool             `json:"allowVolumeExpansion"`
	Parameters           map[string]string `json:"parameters"`
}

// Config & Secrets Metadata (values strictly excluded!)
type K8sConfigMapList struct {
	Items []K8sConfigMap `json:"items"`
}

type K8sConfigMap struct {
	Metadata   K8sObjectMeta          `json:"metadata"`
	Data       map[string]interface{} `json:"data"`       // Used ONLY to extract key names, never data values
	BinaryData map[string]interface{} `json:"binaryData"` // Used ONLY to extract key names
	Immutable  *bool                  `json:"immutable"`
}

type K8sSecretList struct {
	Items []K8sSecret `json:"items"`
}

type K8sSecret struct {
	Metadata   K8sObjectMeta          `json:"metadata"`
	Type       string                 `json:"type"`
	Data       map[string]interface{} `json:"data"`       // Used ONLY to count keys, values are NEVER stored or inspected
	StringData map[string]interface{} `json:"stringData"` // Used ONLY to count keys
	Immutable  *bool                  `json:"immutable"`
}

// Workloads / Batch: Jobs, CronJobs, ReplicaSets
type K8sJobList struct {
	Items []K8sJob `json:"items"`
}

type K8sJob struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Parallelism           *int32 `json:"parallelism"`
		Completions           *int32 `json:"completions"`
		ActiveDeadlineSeconds *int64 `json:"activeDeadlineSeconds"`
		BackoffLimit          *int32 `json:"backoffLimit"`
	} `json:"spec"`
	Status struct {
		Conditions []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			Message            string `json:"message"`
			LastTransitionTime string `json:"lastTransitionTime"`
		} `json:"conditions"`
		StartTime      string `json:"startTime"`
		CompletionTime string `json:"completionTime"`
		Active         int32  `json:"active"`
		Succeeded      int32  `json:"succeeded"`
		Failed         int32  `json:"failed"`
	} `json:"status"`
}

type K8sCronJobList struct {
	Items []K8sCronJob `json:"items"`
}

type K8sCronJob struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Schedule                   string `json:"schedule"`
		Suspend                    *bool  `json:"suspend"`
		ConcurrencyPolicy          string `json:"concurrencyPolicy"`
		SuccessfulJobsHistoryLimit *int32 `json:"successfulJobsHistoryLimit"`
		FailedJobsHistoryLimit     *int32 `json:"failedJobsHistoryLimit"`
	} `json:"spec"`
	Status struct {
		Active             []struct{ Name, Namespace string } `json:"active"`
		LastScheduleTime   string                             `json:"lastScheduleTime"`
		LastSuccessfulTime string                             `json:"lastSuccessfulTime"`
	} `json:"status"`
}

type K8sReplicaSetList struct {
	Items []K8sReplicaSet `json:"items"`
}

type K8sReplicaSet struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Replicas *int32 `json:"replicas"`
	} `json:"spec"`
	Status struct {
		Replicas             int32 `json:"replicas"`
		FullyLabeledReplicas int32 `json:"fullyLabeledReplicas"`
		ReadyReplicas        int32 `json:"readyReplicas"`
		AvailableReplicas    int32 `json:"availableReplicas"`
	} `json:"status"`
}

// Cluster-level governance: Namespaces, ResourceQuotas, LimitRanges
type K8sNamespaceList struct {
	Items []K8sNamespace `json:"items"`
}

type K8sNamespace struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Status   struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type K8sResourceQuotaList struct {
	Items []K8sResourceQuota `json:"items"`
}

type K8sResourceQuota struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Hard map[string]string `json:"hard"`
	} `json:"spec"`
	Status struct {
		Hard map[string]string `json:"hard"`
		Used map[string]string `json:"used"`
	} `json:"status"`
}

type K8sLimitRangeList struct {
	Items []K8sLimitRange `json:"items"`
}

type K8sLimitRange struct {
	Metadata K8sObjectMeta `json:"metadata"`
	Spec     struct {
		Limits []struct {
			Type           string            `json:"type"`
			Max            map[string]string `json:"max"`
			Min            map[string]string `json:"min"`
			Default        map[string]string `json:"default"`
			DefaultRequest map[string]string `json:"defaultRequest"`
		} `json:"limits"`
	} `json:"spec"`
}

// RBAC: ServiceAccount, RoleBinding, ClusterRoleBinding
type K8sServiceAccountList struct {
	Items []K8sServiceAccount `json:"items"`
}

type K8sServiceAccount struct {
	Metadata                     K8sObjectMeta           `json:"metadata"`
	Secrets                      []struct{ Name string } `json:"secrets"`
	ImagePullSecrets             []struct{ Name string } `json:"imagePullSecrets"`
	AutomountServiceAccountToken *bool                   `json:"automountServiceAccountToken"`
}

type K8sRoleBindingList struct {
	Items []K8sRoleBinding `json:"items"`
}

type K8sRoleBinding struct {
	Metadata K8sObjectMeta `json:"metadata"`
	RoleRef  struct {
		APIGroup string `json:"apiGroup"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
	} `json:"roleRef"`
	Subjects []struct {
		Kind      string `json:"kind"`
		APIGroup  string `json:"apiGroup"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"subjects"`
}

type K8sClusterRoleBindingList struct {
	Items []K8sClusterRoleBinding `json:"items"`
}

type K8sClusterRoleBinding struct {
	Metadata K8sObjectMeta `json:"metadata"`
	RoleRef  struct {
		APIGroup string `json:"apiGroup"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
	} `json:"roleRef"`
	Subjects []struct {
		Kind      string `json:"kind"`
		APIGroup  string `json:"apiGroup"`
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"subjects"`
}

// PatchStrategicMerge sends a strategic merge patch to the Kubernetes API
func (k *InClusterK8sClient) PatchStrategicMerge(ctx context.Context, apiPath string, patchBytes []byte) error {
	url := fmt.Sprintf("%s%s", k.apiBaseURL, apiPath)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(patchBytes))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+k.token)
	req.Header.Set("Content-Type", "application/strategic-merge-patch+json")
	req.Header.Set("Accept", "application/json")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("kubernetes API PATCH %s returned HTTP %d: %s", apiPath, resp.StatusCode, string(body))
	}

	return nil
}

// UpdateWorkloadImage applies a typed image patch to a Pod or Deployment
func (k *InClusterK8sClient) UpdateWorkloadImage(ctx context.Context, kind, namespace, name, containerName, newImage string) error {
	if namespace == "" {
		namespace = "default"
	}

	switch strings.ToLower(kind) {
	case "pod":
		patch := map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []map[string]interface{}{
					{
						"name":  containerName,
						"image": newImage,
					},
				},
			},
		}
		patchBytes, err := json.Marshal(patch)
		if err != nil {
			return err
		}
		apiPath := fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", namespace, name)
		return k.PatchStrategicMerge(ctx, apiPath, patchBytes)

	case "deployment":
		patch := map[string]interface{}{
			"spec": map[string]interface{}{
				"template": map[string]interface{}{
					"spec": map[string]interface{}{
						"containers": []map[string]interface{}{
							{
								"name":  containerName,
								"image": newImage,
							},
						},
					},
				},
			},
		}
		patchBytes, err := json.Marshal(patch)
		if err != nil {
			return err
		}
		apiPath := fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments/%s", namespace, name)
		return k.PatchStrategicMerge(ctx, apiPath, patchBytes)

	default:
		return fmt.Errorf("unsupported resource kind for image update: %s", kind)
	}
}
