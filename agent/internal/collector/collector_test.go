package collector

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/queue"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

func TestParseProbe(t *testing.T) {
	// 1. HTTP probe
	httpProbe := &K8sProbe{
		HTTPGet: &struct {
			Path   string      `json:"path"`
			Port   interface{} `json:"port"`
			Scheme string      `json:"scheme"`
		}{
			Path: "/healthz",
			Port: 8080,
		},
		InitialDelaySeconds: 10,
		PeriodSeconds:       5,
		TimeoutSeconds:      2,
		FailureThreshold:    3,
	}

	info := parseProbe(httpProbe)
	if info == nil {
		t.Fatal("Expected parsed probe, got nil")
	}
	if info.Type != "httpGet" || info.Path != "/healthz" || info.Port != "8080" {
		t.Errorf("Unexpected http probe: %+v", info)
	}

	// 2. Exec probe
	execProbe := &K8sProbe{
		Exec: &struct {
			Command []string `json:"command"`
		}{
			Command: []string{"cat", "/tmp/healthy"},
		},
		PeriodSeconds: 15,
	}
	infoExec := parseProbe(execProbe)
	if infoExec.Type != "exec" || infoExec.Path != "cat /tmp/healthy" {
		t.Errorf("Unexpected exec probe: %+v", infoExec)
	}

	// 3. Nil probe
	if parseProbe(nil) != nil {
		t.Error("Expected nil for nil probe")
	}
}

func TestSanitizeAnnotations(t *testing.T) {
	raw := map[string]string{
		"app.kubernetes.io/name":      "skyops-backend",
		"deployment.kubernetes.io/rev": "4",
		"vault.hashicorp.com/secret":  "super-secret-token",
		"internal.token.key":          "xyz123",
		"db.password":                 "p@ssword",
		"auth.credential":             "bearer-token",
		"long.desc":                   strings.Repeat("a", 600),
	}

	sanitized := sanitizeAnnotations(raw)
	if sanitized == nil {
		t.Fatal("Expected sanitized map, got nil")
	}

	if _, found := sanitized["vault.hashicorp.com/secret"]; found {
		t.Error("Failed to strip secret annotation")
	}
	if _, found := sanitized["internal.token.key"]; found {
		t.Error("Failed to strip token annotation")
	}
	if _, found := sanitized["db.password"]; found {
		t.Error("Failed to strip password annotation")
	}
	if _, found := sanitized["auth.credential"]; found {
		t.Error("Failed to strip credential annotation")
	}

	if sanitized["app.kubernetes.io/name"] != "skyops-backend" {
		t.Errorf("Safe annotation was modified: %v", sanitized["app.kubernetes.io/name"])
	}

	if len(sanitized["long.desc"]) > 520 {
		t.Errorf("Long annotation was not truncated: len=%d", len(sanitized["long.desc"]))
	}
}

func TestConvertOwnerReferences(t *testing.T) {
	isCtrl := true
	raw := []struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		UID        string `json:"uid"`
		Controller *bool  `json:"controller"`
	}{
		{
			APIVersion: "apps/v1",
			Kind:       "Deployment",
			Name:       "api-gateway",
			UID:        "uid-123",
			Controller: &isCtrl,
		},
	}

	res := convertOwnerReferences(raw)
	if len(res) != 1 {
		t.Fatalf("Expected 1 owner ref, got %d", len(res))
	}
	if res[0].Kind != "Deployment" || res[0].Name != "api-gateway" || !res[0].Controller {
		t.Errorf("Unexpected converted owner ref: %+v", res[0])
	}
}

func TestCollectionWithMockK8sServer(t *testing.T) {
	mux := http.NewServeMux()

	// 1. Services
	mux.HandleFunc("/api/v1/services", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(K8sServiceList{
			Items: []K8sService{
				{
					Metadata: K8sObjectMeta{Name: "frontend-svc", Namespace: "prod", UID: "svc-1"},
					Spec: struct {
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
					}{
						Type:      "ClusterIP",
						ClusterIP: "10.96.0.10",
						Selector:  map[string]string{"app": "frontend"},
					},
				},
			},
		})
	})

	// 2. Ingresses
	mux.HandleFunc("/apis/networking.k8s.io/v1/ingresses", func(w http.ResponseWriter, r *http.Request) {
		className := "nginx"
		json.NewEncoder(w).Encode(K8sIngressList{
			Items: []K8sIngress{
				{
					Metadata: K8sObjectMeta{Name: "main-ingress", Namespace: "prod", UID: "ing-1"},
					Spec: struct {
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
					}{
						IngressClassName: &className,
					},
				},
			},
		})
	})

	// 3. ConfigMaps (Metadata only, sensitive values excluded)
	mux.HandleFunc("/api/v1/configmaps", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(K8sConfigMapList{
			Items: []K8sConfigMap{
				{
					Metadata: K8sObjectMeta{Name: "app-config", Namespace: "prod", UID: "cm-1"},
					Data: map[string]interface{}{
						"LOG_LEVEL":   "info",
						"APP_PORT":    "8080",
						"CONFIG_JSON": "{sensitive: false}",
					},
				},
			},
		})
	})

	// 4. Secrets (Count only, sensitive contents NEVER exposed)
	mux.HandleFunc("/api/v1/secrets", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("labelSelector") == "owner=helm" {
			// Helm release secret
			json.NewEncoder(w).Encode(K8sSecretList{
				Items: []K8sSecret{
					{
						Metadata: K8sObjectMeta{
							Name:      "sh.helm.release.v1.ingress-nginx.v2",
							Namespace: "ingress-system",
							UID:       "helm-sec-1",
							Labels: map[string]string{
								"owner":   "helm",
								"name":    "ingress-nginx",
								"status":  "deployed",
								"version": "2",
							},
							Annotations: map[string]string{
								"chart":       "ingress-nginx-4.8.3",
								"description": "Upgrade complete",
							},
						},
						Type: "helm.sh/release.v1",
					},
				},
			})
			return
		}

		json.NewEncoder(w).Encode(K8sSecretList{
			Items: []K8sSecret{
				{
					Metadata: K8sObjectMeta{Name: "db-credentials", Namespace: "prod", UID: "sec-1"},
					Type:     "Opaque",
					Data: map[string]interface{}{
						"password": "SUPER_SECRET_VALUE",
						"username": "admin",
					},
				},
			},
		})
	})

	// 5. PersistentVolumes
	mux.HandleFunc("/api/v1/persistentvolumes", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(K8sPersistentVolumeList{
			Items: []K8sPersistentVolume{
				{
					Metadata: K8sObjectMeta{Name: "pv-volume-1", UID: "pv-1"},
					Spec: struct {
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
					}{
						Capacity:         map[string]string{"storage": "100Gi"},
						StorageClassName: "standard",
					},
					Status: struct {
						Phase   string `json:"phase"`
						Message string `json:"message"`
						Reason  string `json:"reason"`
					}{
						Phase: "Bound",
					},
				},
			},
		})
	})

	// 6. StorageClasses
	mux.HandleFunc("/apis/storage.k8s.io/v1/storageclasses", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(K8sStorageClassList{
			Items: []K8sStorageClass{
				{
					Metadata:    K8sObjectMeta{Name: "standard", UID: "sc-1"},
					Provisioner: "kubernetes.io/gce-pd",
				},
			},
		})
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	customClient := NewCustomK8sClient(server.Client(), server.URL, "test-token")
	cfg := &config.Config{
		ServerURL:         server.URL,
		ClusterID:         "test-cluster",
		TelemetryInterval: 10 * time.Second,
	}
	q := queue.NewBoundedQueue(100)
	dummyTransport := transport.NewClient(cfg)
	col := NewCollector(cfg, dummyTransport, q, customClient)

	ctx := context.Background()

	// Test collectServices
	eventsMap := make(map[string][]EventObservation)
	svcs, svcStat := col.collectServices(ctx, eventsMap)
	if !svcStat.Success {
		t.Fatalf("Services collection failed: %v", svcStat.Error)
	}
	if len(svcs) != 1 || svcs[0].Name != "frontend-svc" {
		t.Errorf("Unexpected svcs result: %+v", svcs)
	}

	// Test collectIngresses
	ings, ingStat := col.collectIngresses(ctx, eventsMap)
	if !ingStat.Success {
		t.Fatalf("Ingresses collection failed: %v", ingStat.Error)
	}
	if len(ings) != 1 || ings[0].Name != "main-ingress" {
		t.Errorf("Unexpected ings result: %+v", ings)
	}

	// Test collectConfigMaps (verifying NO DATA values are in observation)
	cms, cmStat := col.collectConfigMaps(ctx)
	if !cmStat.Success {
		t.Fatalf("ConfigMaps collection failed: %v", cmStat.Error)
	}
	if len(cms) != 1 || cms[0].Name != "app-config" {
		t.Errorf("Unexpected cms result: %+v", cms)
	}
	keys := cms[0].SpecSummary["keys"].([]string)
	if len(keys) != 3 {
		t.Errorf("Expected 3 key names, got %d", len(keys))
	}
	// Verify data values are NOT stored
	if _, ok := cms[0].SpecSummary["data"]; ok {
		t.Error("Security violation: Raw ConfigMap data found in SpecSummary!")
	}

	// Test collectSecrets (verifying NO DATA values or passwords are in observation)
	secs, secStat := col.collectSecrets(ctx)
	if !secStat.Success {
		t.Fatalf("Secrets collection failed: %v", secStat.Error)
	}
	if len(secs) != 1 || secs[0].Name != "db-credentials" {
		t.Errorf("Unexpected secs result: %+v", secs)
	}
	if secs[0].SpecSummary["keyCount"].(int) != 2 {
		t.Errorf("Expected 2 keys, got %v", secs[0].SpecSummary["keyCount"])
	}
	if _, ok := secs[0].SpecSummary["data"]; ok {
		t.Error("Security violation: Raw Secret data found in SpecSummary!")
	}

	// Test collectHelmReleases
	helms, helmStat := col.collectHelmReleases(ctx)
	if !helmStat.Success {
		t.Fatalf("Helm release collection failed: %v", helmStat.Error)
	}
	if len(helms) != 1 || helms[0].Name != "ingress-nginx" {
		t.Errorf("Unexpected helm release: %+v", helms)
	}
	if helms[0].SpecSummary["chart"] != "ingress-nginx-4.8.3" {
		t.Errorf("Unexpected helm chart: %v", helms[0].SpecSummary["chart"])
	}
}

func TestPartialFailureResilience(t *testing.T) {
	mux := http.NewServeMux()

	// Mock endpoint returning 403 Forbidden for Ingresses (e.g. ClusterRole missing Ingress permissions)
	mux.HandleFunc("/apis/networking.k8s.io/v1/ingresses", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"kind":"Status","status":"Failure","message":"ingresses.networking.k8s.io is forbidden"}`))
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	customClient := NewCustomK8sClient(server.Client(), server.URL, "test-token")
	cfg := &config.Config{ClusterID: "test-cluster"}
	col := NewCollector(cfg, nil, queue.NewBoundedQueue(10), customClient)

	eventsMap := make(map[string][]EventObservation)
	ings, ingStat := col.collectIngresses(context.Background(), eventsMap)

	// Partial failure should be safely caught
	if ingStat.Success {
		t.Error("Expected ingStat.Success to be false on HTTP 403")
	}
	if ingStat.StatusCode != http.StatusForbidden {
		t.Errorf("Expected status code 403, got %d", ingStat.StatusCode)
	}
	if !strings.Contains(ingStat.Error, "403") {
		t.Errorf("Expected error to mention 403, got %s", ingStat.Error)
	}
	if len(ings) != 0 {
		t.Errorf("Expected 0 ings on failure, got %d", len(ings))
	}
}
