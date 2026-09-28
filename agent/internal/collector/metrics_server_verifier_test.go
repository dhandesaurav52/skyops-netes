package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerifyMetricsServer_NotInstalled(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/kube-system/deployments":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[]}`))
		case "/api/v1/namespaces/kube-system/pods":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[]}`))
		case "/apis/metrics.k8s.io/v1beta1":
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"404 page not found"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res := VerifyMetricsServer(context.Background(), client, "c1", "req-1")

	if res.Status != "NOT_INSTALLED" {
		t.Fatalf("expected NOT_INSTALLED, got %s", res.Status)
	}
	if res.DeploymentFound {
		t.Fatalf("expected DeploymentFound=false")
	}
}

func TestVerifyMetricsServer_InstalledNotReady(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/kube-system/deployments":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server","namespace":"kube-system"},"spec":{"replicas":1},"status":{"replicas":1,"readyReplicas":0}}]}`))
		case "/api/v1/namespaces/kube-system/pods":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server-xyz","namespace":"kube-system"},"status":{"phase":"Pending","conditions":[{"type":"Ready","status":"False"}]}}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res := VerifyMetricsServer(context.Background(), client, "c1", "req-2")

	if res.Status != "INSTALLED_NOT_READY" {
		t.Fatalf("expected INSTALLED_NOT_READY, got %s", res.Status)
	}
	if !res.DeploymentFound {
		t.Fatalf("expected DeploymentFound=true")
	}
	if res.DeploymentReady {
		t.Fatalf("expected DeploymentReady=false")
	}
}

func TestVerifyMetricsServer_PermissionDenied(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/kube-system/deployments":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server","namespace":"kube-system"},"spec":{"replicas":1},"status":{"replicas":1,"readyReplicas":1}}]}`))
		case "/api/v1/namespaces/kube-system/pods":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server-xyz","namespace":"kube-system"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}`))
		case "/apis/metrics.k8s.io/v1beta1":
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"kind":"Status","status":"Failure","message":"User cannot get resource in API group metrics.k8s.io"}`))
		default:
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"forbidden"}`))
		}
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res := VerifyMetricsServer(context.Background(), client, "c1", "req-3")

	if res.Status != "PERMISSION_DENIED" {
		t.Fatalf("expected PERMISSION_DENIED, got %s", res.Status)
	}
}

func TestVerifyMetricsServer_ReadyWithMetrics(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/kube-system/deployments":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server","namespace":"kube-system"},"spec":{"replicas":1},"status":{"replicas":1,"readyReplicas":1}}]}`))
		case "/api/v1/namespaces/kube-system/pods":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"metrics-server-xyz","namespace":"kube-system"},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}`))
		case "/apis/metrics.k8s.io/v1beta1":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"kind":"APIResourceList","groupVersion":"metrics.k8s.io/v1beta1"}`))
		case "/apis/metrics.k8s.io/v1beta1/nodes":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"node-1"},"usage":{"cpu":"120m","memory":"1024Mi"}}]}`))
		case "/apis/metrics.k8s.io/v1beta1/pods":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[{"metadata":{"name":"pod-1","namespace":"default"},"containers":[{"name":"c1","usage":{"cpu":"10m","memory":"64Mi"}}]}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res := VerifyMetricsServer(context.Background(), client, "c1", "req-4")

	if res.Status != "READY_WITH_METRICS" {
		t.Fatalf("expected READY_WITH_METRICS, got %s", res.Status)
	}
	if !res.DeploymentReady || !res.PodReady || !res.APIReachable || !res.NodeMetricsAvailable || !res.PodMetricsAvailable {
		t.Fatalf("expected all readiness flags true, got %+v", res)
	}
	if res.NodeMetricsCount != 1 || res.PodMetricsCount != 1 {
		t.Fatalf("expected 1 node and 1 pod metric, got %d / %d", res.NodeMetricsCount, res.PodMetricsCount)
	}
}
