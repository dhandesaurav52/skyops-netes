package collector

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/metrics"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

func TestGetPodLogs_Success(t *testing.T) {
	expectedLogs := "[INFO] CoreDNS-1.11.1 starting up\n[INFO] plugin/reload: Running configuration MD5 = f4a\n[INFO] plugin/kubernetes: CoreDNS-kubernetes ready\n"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-sa-token" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if r.URL.Path != "/api/v1/namespaces/kube-system/pods/coredns-test/log" {
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}

		query := r.URL.Query()
		if query.Get("container") != "coredns" {
			http.Error(w, "Invalid container", http.StatusBadRequest)
			return
		}
		if query.Get("tailLines") != "250" {
			http.Error(w, "Expected tailLines=250", http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedLogs))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-sa-token")
	res, err := client.GetPodLogs(context.Background(), "kube-system", "coredns-test", PodLogOptions{
		Container: "coredns",
		TailLines: 250,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "SUCCESS" {
		t.Fatalf("expected SUCCESS, got %s", res.Status)
	}
	if res.Logs != expectedLogs {
		t.Fatalf("expected logs %q, got %q", expectedLogs, res.Logs)
	}
	if res.LinesReturned != 3 {
		t.Fatalf("expected 3 lines returned, got %d", res.LinesReturned)
	}
}

func TestGetPodLogs_StandardHeaders(t *testing.T) {
	var capturedAcceptHeader string
	var capturedAuthHeader string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAcceptHeader = r.Header.Get("Accept")
		capturedAuthHeader = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("2026-09-16T10:00:00Z server listening on :8080\n"))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "api-server", PodLogOptions{
		Container: "api",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "SUCCESS" {
		t.Fatalf("expected SUCCESS, got %s", res.Status)
	}
	// Verify Authorization header is preserved
	if capturedAuthHeader != "Bearer test-token" {
		t.Errorf("expected Authorization Bearer test-token, got %s", capturedAuthHeader)
	}
	// Verify that invalid text/plain is NOT set on Accept header (which causes k8s 406 NotAcceptable)
	if strings.Contains(capturedAcceptHeader, "text/plain") {
		t.Errorf("expected Accept header to NOT contain text/plain, got: %s", capturedAcceptHeader)
	}
}

func TestGetPodLogs_HTTP406_TruthfulDiagnostic(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotAcceptable)
		_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","message":"only the following media types are accepted: application/json, application/yaml, application/vnd.kubernetes.protobuf","reason":"NotAcceptable","code":406}`))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "strict-gateway-pod", PodLogOptions{
		Container: "app",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "KUBERNETES_API_UNAVAILABLE" {
		t.Fatalf("expected KUBERNETES_API_UNAVAILABLE, got %s", res.Status)
	}
	if !strings.Contains(res.ErrorMessage, "406 NotAcceptable") {
		t.Fatalf("expected 406 NotAcceptable diagnostic, got: %s", res.ErrorMessage)
	}
	if !strings.Contains(res.ErrorMessage, "media types") {
		t.Fatalf("expected message to reference media types, got: %s", res.ErrorMessage)
	}
}

func TestGetPodLogs_PreviousLogs(t *testing.T) {
	expectedPrevLogs := "Terminating container gracefully\n"

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("previous") != "true" {
			http.Error(w, "previous query param missing", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedPrevLogs))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "my-pod", PodLogOptions{
		Container: "worker",
		Previous:  true,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "SUCCESS" {
		t.Fatalf("expected SUCCESS, got %s", res.Status)
	}
	if res.Logs != expectedPrevLogs {
		t.Fatalf("expected %q, got %q", expectedPrevLogs, res.Logs)
	}
}

func TestGetPodLogs_PermissionDenied(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `pods "coredns/log" is forbidden: User "system:serviceaccount:skyops:skyops-agent" cannot get resource "pods/log"`, http.StatusForbidden)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "kube-system", "coredns", PodLogOptions{
		Container: "coredns",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "PERMISSION_DENIED" {
		t.Fatalf("expected PERMISSION_DENIED, got %s", res.Status)
	}
	if !strings.Contains(res.ErrorMessage, "permission") {
		t.Fatalf("expected permission message, got %s", res.ErrorMessage)
	}
}

func TestGetPodLogs_PodNotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `pods "missing-pod" not found`, http.StatusNotFound)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "missing-pod", PodLogOptions{
		Container: "app",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "POD_NOT_FOUND" {
		t.Fatalf("expected POD_NOT_FOUND, got %s", res.Status)
	}
}

func TestGetPodLogs_ContainerNotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `container "non-existent" in pod "my-pod" is not valid for pod`, http.StatusBadRequest)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "my-pod", PodLogOptions{
		Container: "non-existent",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "CONTAINER_NOT_FOUND" {
		t.Fatalf("expected CONTAINER_NOT_FOUND, got %s", res.Status)
	}
}

func TestGetPodLogs_PreviousLogsUnavailable(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `previous terminated container "app" in pod "my-pod" not found`, http.StatusBadRequest)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "my-pod", PodLogOptions{
		Container: "app",
		Previous:  true,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "PREVIOUS_LOGS_UNAVAILABLE" {
		t.Fatalf("expected PREVIOUS_LOGS_UNAVAILABLE, got %s", res.Status)
	}
}

func TestGetPodLogs_EmptyLogs(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(""))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "quiet-pod", PodLogOptions{
		Container: "quiet",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "NO_LOGS" {
		t.Fatalf("expected NO_LOGS, got %s", res.Status)
	}
}

func TestGetPodLogs_TailAndByteLimits(t *testing.T) {
	var requestedTail string
	var requestedLimit string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestedTail = r.URL.Query().Get("tailLines")
		requestedLimit = r.URL.Query().Get("limitBytes")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("line 1\nline 2\n"))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")

	// Over bounds
	_, err := client.GetPodLogs(context.Background(), "default", "pod-limits", PodLogOptions{
		Container:  "app",
		TailLines:  5000,           // Should be clamped to 1000
		LimitBytes: 10 * 1024 * 1024, // Should be clamped to 512KB
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if requestedTail != "1000" {
		t.Errorf("expected tailLines clamped to 1000, got %s", requestedTail)
	}
	if requestedLimit != "524288" {
		t.Errorf("expected limitBytes clamped to 524288, got %s", requestedLimit)
	}
}

func TestGetPodLogs_Timeout(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "slow-pod", PodLogOptions{
		Container: "app",
		Timeout:   10 * time.Millisecond,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "TIMEOUT" {
		t.Fatalf("expected TIMEOUT, got %s", res.Status)
	}
}

func TestGetPodLogs_AllQueryParams(t *testing.T) {
	var capturedQuery map[string][]string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedQuery = r.URL.Query()
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("log line 1\nlog line 2\n"))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "prod", "worker-1", PodLogOptions{
		Container:    "app-worker",
		TailLines:    150,
		Previous:     true,
		Timestamps:   true,
		SinceSeconds: 300,
		LimitBytes:   65536,
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "SUCCESS" {
		t.Fatalf("expected SUCCESS, got %s", res.Status)
	}
	if capturedQuery["container"][0] != "app-worker" {
		t.Errorf("expected container=app-worker, got %v", capturedQuery["container"])
	}
	if capturedQuery["tailLines"][0] != "150" {
		t.Errorf("expected tailLines=150, got %v", capturedQuery["tailLines"])
	}
	if capturedQuery["previous"][0] != "true" {
		t.Errorf("expected previous=true, got %v", capturedQuery["previous"])
	}
	if capturedQuery["timestamps"][0] != "true" {
		t.Errorf("expected timestamps=true, got %v", capturedQuery["timestamps"])
	}
	if capturedQuery["sinceSeconds"][0] != "300" {
		t.Errorf("expected sinceSeconds=300, got %v", capturedQuery["sinceSeconds"])
	}
	if capturedQuery["limitBytes"][0] != "65536" {
		t.Errorf("expected limitBytes=65536, got %v", capturedQuery["limitBytes"])
	}
}

func TestGetPodLogs_Unauthorized(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "bad-token")
	res, err := client.GetPodLogs(context.Background(), "default", "secure-pod", PodLogOptions{
		Container: "app",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "PERMISSION_DENIED" {
		t.Fatalf("expected PERMISSION_DENIED for 401 Unauthorized, got %s", res.Status)
	}
}

func TestGetPodLogs_NotFound_Container(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"kind":"Status","message":"container \"sidecar\" not found","code":404}`))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "app-pod", PodLogOptions{
		Container: "sidecar",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "CONTAINER_NOT_FOUND" {
		t.Fatalf("expected CONTAINER_NOT_FOUND for 404 mentioning container, got %s", res.Status)
	}
}

func TestGetPodLogs_ContainerCreating_NoLogs(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"kind":"Status","message":"container \"init\" is waiting to start: ContainerCreating","code":400}`))
	}))
	defer ts.Close()

	client := NewCustomK8sClient(ts.Client(), ts.URL, "test-token")
	res, err := client.GetPodLogs(context.Background(), "default", "starting-pod", PodLogOptions{
		Container: "init",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Status != "NO_LOGS" {
		t.Fatalf("expected NO_LOGS for waiting to start container, got %s", res.Status)
	}
}

func TestLogCollector_PollAndDispatch(t *testing.T) {
	var receivedPayload transport.LogIngestPayload
	backendTs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/agent/logs/requests" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"requests":[{"id":"req-42","namespace":"kube-system","podName":"coredns","container":"coredns","tailLines":100}]}`))
			return
		}
		if r.URL.Path == "/api/v1/agent/logs" {
			if r.Header.Get("Authorization") != "Bearer secret-agent-token" {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer backendTs.Close()

	k8sTs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("coredns log content\n"))
	}))
	defer k8sTs.Close()

	cfg := &config.Config{
		ClusterID:          "cls-test-1",
		AgentID:            "agent-test-1",
		AgentToken:         "secret-agent-token",
		ServerURL:          backendTs.URL,
		MaxLogTailLines:    250,
		MaxLogBytes:        512 * 1024,
		LogRequestTimeout:  2 * time.Second,
		LogPollInterval:    50 * time.Millisecond,
	}

	transportClient := transport.NewClient(cfg)
	kClient := NewCustomK8sClient(k8sTs.Client(), k8sTs.URL, "k8s-token")

	collector := NewLogCollector(cfg, transportClient, kClient, metrics.Default)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	collector.pollAndProcess(ctx)
	_ = receivedPayload
}
