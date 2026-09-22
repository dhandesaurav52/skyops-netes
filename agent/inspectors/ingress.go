package inspectors

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	// DefaultCertWarningDays flags certificates expiring within 30 days
	DefaultCertWarningDays = 30
	// DefaultCertCriticalDays flags certificates expiring within 7 days
	DefaultCertCriticalDays = 7
	// DefaultProbeTimeout is the maximum duration for a synthetic network probe
	DefaultProbeTimeout = 10 * time.Second
)

// IngressErrorType categorizes detected network, routing, and HTTP failures
type IngressErrorType string

const (
	ErrorNone                    IngressErrorType = "NONE"
	ErrorBadGateway              IngressErrorType = "BAD_GATEWAY"               // HTTP 502
	ErrorGatewayTimeout          IngressErrorType = "GATEWAY_TIMEOUT"           // HTTP 504
	ErrorBackendUnreachable      IngressErrorType = "BACKEND_UNREACHABLE"       // HTTP 503 / Conn Refused
	ErrorRoutingMisconfiguration IngressErrorType = "ROUTING_MISCONFIGURATION"  // HTTP 404 / 400
	ErrorDNSResolutionFailed     IngressErrorType = "DNS_RESOLUTION_FAILED"
	ErrorCertExpired             IngressErrorType = "CERT_EXPIRED"
	ErrorCertExpiringSoon        IngressErrorType = "CERT_EXPIRING_SOON"
	ErrorSyntheticTimeout        IngressErrorType = "SYNTHETIC_PROBE_TIMEOUT"
	ErrorHTTPFailure             IngressErrorType = "HTTP_ERROR"
)

// EndpointProbeResult records synthetic health metrics and latency breakdown for an ingress endpoint
type EndpointProbeResult struct {
	URL                     string           `json:"url"`
	Host                    string           `json:"host"`
	Path                    string           `json:"path"`
	Scheme                  string           `json:"scheme"`
	Reachable               bool             `json:"reachable"`
	StatusCode              int              `json:"statusCode"`
	LatencyMs               int64            `json:"latencyMs"`
	DNSLookupDurationMs     int64            `json:"dnsLookupDurationMs"`
	TCPConnectionDurationMs int64            `json:"tcpConnectionDurationMs"`
	TLSHandshakeDurationMs  int64            `json:"tlsHandshakeDurationMs"`
	ServerHeader            string           `json:"serverHeader,omitempty"`
	ErrorType               IngressErrorType `json:"errorType"`
	ErrorMessage            string           `json:"errorMessage,omitempty"`
	ProbedAt                int64            `json:"probedAt"`
}

// TLSCertReport details SSL/TLS certificate validity, expiration timelines, and subject metadata
type TLSCertReport struct {
	HostPort               string    `json:"hostPort"`
	Subject                string    `json:"subject"`
	Issuer                 string    `json:"issuer"`
	DNSNames               []string  `json:"dnsNames"`
	NotBefore              time.Time `json:"notBefore"`
	NotAfter               time.Time `json:"notAfter"`
	DaysUntilExpiration    int       `json:"daysUntilExpiration"`
	HoursUntilExpiration   int       `json:"hoursUntilExpiration"`
	IsExpired              bool      `json:"isExpired"`
	IsExpiringSoon         bool      `json:"isExpiringSoon"`
	Status                 string    `json:"status"` // VALID, EXPIRING_SOON, CRITICAL, EXPIRED
	SerialNumber           string    `json:"serialNumber"`
	TLSVersion             string    `json:"tlsVersion"`
	CipherSuite            string    `json:"cipherSuite"`
}

// IngressInspectionReport compiles live status, synthetic probe health, and TLS audit for an Ingress
type IngressInspectionReport struct {
	Name           string                `json:"name"`
	Namespace      string                `json:"namespace"`
	IngressClass   string                `json:"ingressClass,omitempty"`
	Hosts          []string              `json:"hosts"`
	TLSConfigured  bool                  `json:"tlsConfigured"`
	TLSCerts       []TLSCertReport       `json:"tlsCerts,omitempty"`
	EndpointProbes []EndpointProbeResult `json:"endpointProbes"`
	Healthy        bool                  `json:"healthy"`
	Issues         []string              `json:"issues"`
	Labels         map[string]string     `json:"labels,omitempty"`
	InspectedAt    int64                 `json:"inspectedAt"`
}

// IngressInspector performs active synthetic health validation on Kubernetes Ingresses
type IngressInspector struct {
	k8sClient       kubernetes.Interface
	probeTimeout    time.Duration
	certWarningDays int
	httpClient      *http.Client
	mu              sync.RWMutex
}

// NewIngressInspector creates an ingress and network health inspector
func NewIngressInspector(k8sClient kubernetes.Interface, probeTimeout time.Duration, certWarningDays int) *IngressInspector {
	if probeTimeout <= 0 {
		probeTimeout = DefaultProbeTimeout
	}
	if certWarningDays <= 0 {
		certWarningDays = DefaultCertWarningDays
	}

	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 15 * time.Second,
		}).DialContext,
		// Skip verify during synthetic probe so we can inspect certs even if self-signed or expired
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true,
		},
		MaxIdleConns:          50,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &IngressInspector{
		k8sClient:       k8sClient,
		probeTimeout:    probeTimeout,
		certWarningDays: certWarningDays,
		httpClient: &http.Client{
			Transport: transport,
			Timeout:   probeTimeout,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 3 {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
	}
}

// Inspect audits Ingresses in a single namespace
func (i *IngressInspector) Inspect(ctx context.Context, namespace string) ([]IngressInspectionReport, error) {
	if i.k8sClient == nil {
		return nil, fmt.Errorf("kubernetes client interface is nil")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	ingList, err := i.k8sClient.NetworkingV1().Ingresses(namespace).List(timeoutCtx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to query Ingresses in namespace %s: %w", namespace, err)
	}

	var reports []IngressInspectionReport
	for idx := range ingList.Items {
		item := &ingList.Items[idx]
		rep := i.evaluateIngress(ctx, item)
		reports = append(reports, rep)
	}

	return reports, nil
}

// InspectAll audits Ingresses across all namespaces in the cluster
func (i *IngressInspector) InspectAll(ctx context.Context) ([]IngressInspectionReport, error) {
	return i.Inspect(ctx, metav1.NamespaceAll)
}

// evaluateIngress tests active HTTP/HTTPS endpoint health and TLS certificates for an Ingress
func (i *IngressInspector) evaluateIngress(ctx context.Context, ing *networkingv1.Ingress) IngressInspectionReport {
	now := time.Now().UnixMilli()
	report := IngressInspectionReport{
		Name:           ing.Name,
		Namespace:      ing.Namespace,
		Hosts:          make([]string, 0),
		EndpointProbes: make([]EndpointProbeResult, 0),
		TLSCerts:       make([]TLSCertReport, 0),
		Healthy:        true,
		Issues:         make([]string, 0),
		Labels:         ing.Labels,
		InspectedAt:    now,
	}

	if ing.Spec.IngressClassName != nil {
		report.IngressClass = *ing.Spec.IngressClassName
	}

	tlsHosts := make(map[string]bool)
	if len(ing.Spec.TLS) > 0 {
		report.TLSConfigured = true
		for _, tlsEntry := range ing.Spec.TLS {
			for _, h := range tlsEntry.Hosts {
				tlsHosts[h] = true
			}
		}
	}

	// Gather endpoints to probe
	type probeTarget struct {
		Scheme string
		Host   string
		Path   string
	}
	var targets []probeTarget

	for _, rule := range ing.Spec.Rules {
		host := rule.Host
		if host != "" {
			report.Hosts = append(report.Hosts, host)
		}

		if rule.HTTP != nil {
			for _, p := range rule.HTTP.Paths {
				path := p.Path
				if path == "" {
					path = "/"
				}

				scheme := "http"
				if tlsHosts[host] || report.TLSConfigured {
					scheme = "https"
				}

				if host != "" {
					targets = append(targets, probeTarget{Scheme: scheme, Host: host, Path: path})
				}
			}
		}
	}

	// 1. Audit TLS Certificates for configured hosts
	for host := range tlsHosts {
		if host == "" {
			continue
		}
		certRep, certErr := i.CheckTLSCert(ctx, net.JoinHostPort(host, "443"))
		if certErr != nil {
			report.Issues = append(report.Issues, fmt.Sprintf("TLS audit failed for host %s: %v", host, certErr))
		} else if certRep != nil {
			report.TLSCerts = append(report.TLSCerts, *certRep)
			if certRep.IsExpired {
				report.Healthy = false
				report.Issues = append(report.Issues, fmt.Sprintf("CRITICAL: SSL/TLS certificate for %s expired on %s", host, certRep.NotAfter.Format("2006-01-02")))
			} else if certRep.IsExpiringSoon {
				report.Issues = append(report.Issues, fmt.Sprintf("WARNING: SSL/TLS certificate for %s expires in %d days (%s)", host, certRep.DaysUntilExpiration, certRep.NotAfter.Format("2006-01-02")))
			}
		}
	}

	// 2. Perform synthetic probes across endpoints
	for _, target := range targets {
		probeURL := fmt.Sprintf("%s://%s%s", target.Scheme, target.Host, target.Path)
		probeRes := i.InspectEndpoint(ctx, probeURL)
		report.EndpointProbes = append(report.EndpointProbes, probeRes)

		if !probeRes.Reachable || (probeRes.StatusCode >= 500 && probeRes.StatusCode <= 599) {
			report.Healthy = false
			switch probeRes.ErrorType {
			case ErrorBadGateway:
				report.Issues = append(report.Issues, fmt.Sprintf("502 BAD GATEWAY detected on %s: backend returned invalid response or is unresponsive", probeURL))
			case ErrorGatewayTimeout:
				report.Issues = append(report.Issues, fmt.Sprintf("504 GATEWAY TIMEOUT detected on %s: upstream backend service timed out", probeURL))
			case ErrorBackendUnreachable:
				report.Issues = append(report.Issues, fmt.Sprintf("BACKEND UNREACHABLE for %s: %s", probeURL, probeRes.ErrorMessage))
			case ErrorRoutingMisconfiguration:
				report.Issues = append(report.Issues, fmt.Sprintf("ROUTING MISCONFIGURATION on %s: received HTTP %d", probeURL, probeRes.StatusCode))
			default:
				report.Issues = append(report.Issues, fmt.Sprintf("PROBE FAILURE on %s (HTTP %d): %s", probeURL, probeRes.StatusCode, probeRes.ErrorMessage))
			}
		}
	}

	return report
}

// InspectEndpoint runs an instrumented synthetic HTTP request against the specified target URL
func (i *IngressInspector) InspectEndpoint(ctx context.Context, targetURL string) EndpointProbeResult {
	now := time.Now().UnixMilli()
	result := EndpointProbeResult{
		URL:       targetURL,
		ErrorType: ErrorNone,
		ProbedAt:  now,
	}

	parsed, err := url.Parse(targetURL)
	if err != nil {
		result.ErrorType = ErrorRoutingMisconfiguration
		result.ErrorMessage = fmt.Sprintf("invalid URL syntax: %v", err)
		return result
	}

	result.Host = parsed.Host
	result.Path = parsed.Path
	result.Scheme = parsed.Scheme

	var dnsStart, tcpStart, tlsStart time.Time
	var dnsDuration, tcpDuration, tlsDuration time.Duration

	trace := &httptrace.ClientTrace{
		DNSStart: func(info httptrace.DNSStartInfo) {
			dnsStart = time.Now()
		},
		DNSDone: func(info httptrace.DNSDoneInfo) {
			if !dnsStart.IsZero() {
				dnsDuration = time.Since(dnsStart)
			}
		},
		ConnectStart: func(network, addr string) {
			tcpStart = time.Now()
		},
		ConnectDone: func(network, addr string, err error) {
			if !tcpStart.IsZero() {
				tcpDuration = time.Since(tcpStart)
			}
		},
		TLSHandshakeStart: func() {
			tlsStart = time.Now()
		},
		TLSHandshakeDone: func(state tls.ConnectionState, err error) {
			if !tlsStart.IsZero() {
				tlsDuration = time.Since(tlsStart)
			}
		},
	}

	probeCtx, cancel := context.WithTimeout(ctx, i.probeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(httptrace.WithClientTrace(probeCtx, trace), http.MethodGet, targetURL, nil)
	if err != nil {
		result.ErrorType = ErrorRoutingMisconfiguration
		result.ErrorMessage = err.Error()
		return result
	}

	req.Header.Set("User-Agent", "SkyOps-SyntheticProbe/1.5")
	req.Header.Set("Accept", "*/*")

	start := time.Now()
	resp, err := i.httpClient.Do(req)
	latency := time.Since(start)

	result.LatencyMs = latency.Milliseconds()
	result.DNSLookupDurationMs = dnsDuration.Milliseconds()
	result.TCPConnectionDurationMs = tcpDuration.Milliseconds()
	result.TLSHandshakeDurationMs = tlsDuration.Milliseconds()

	if err != nil {
		result.Reachable = false
		result.ErrorMessage = err.Error()

		if probeCtx.Err() == context.DeadlineExceeded {
			result.ErrorType = ErrorSyntheticTimeout
		} else if strings.Contains(err.Error(), "no such host") {
			result.ErrorType = ErrorDNSResolutionFailed
		} else if strings.Contains(err.Error(), "connection refused") {
			result.ErrorType = ErrorBackendUnreachable
		} else {
			result.ErrorType = ErrorBackendUnreachable
		}
		return result
	}
	defer resp.Body.Close()

	result.Reachable = true
	result.StatusCode = resp.StatusCode
	result.ServerHeader = resp.Header.Get("Server")

	// Classify response status code anomalies
	switch resp.StatusCode {
	case http.StatusBadGateway: // 502
		result.ErrorType = ErrorBadGateway
		result.ErrorMessage = "502 Bad Gateway: upstream server or ingress controller backend returned invalid response"
	case http.StatusGatewayTimeout: // 504
		result.ErrorType = ErrorGatewayTimeout
		result.ErrorMessage = "504 Gateway Timeout: upstream backend service failed to respond within ingress timeout"
	case http.StatusServiceUnavailable: // 503
		result.ErrorType = ErrorBackendUnreachable
		result.ErrorMessage = "503 Service Unavailable: backend pods may be down or endpoints depleted"
	case http.StatusNotFound: // 404
		if parsed.Path != "/" {
			result.ErrorType = ErrorRoutingMisconfiguration
			result.ErrorMessage = "404 Not Found: path may not match ingress routing rule or upstream route"
		}
	default:
		if resp.StatusCode >= 500 {
			result.ErrorType = ErrorHTTPFailure
			result.ErrorMessage = fmt.Sprintf("HTTP server error status %d", resp.StatusCode)
		}
	}

	return result
}

// CheckTLSCert connects via TLS and extracts certificate expiration timelines and cipher parameters
func (i *IngressInspector) CheckTLSCert(ctx context.Context, hostPort string) (*TLSCertReport, error) {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
	}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: true, // Allow inspection of expired or self-signed certs
	}

	conn, err := tls.DialWithDialer(dialer, "tcp", hostPort, tlsConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to dial TLS endpoint %s: %w", hostPort, err)
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, fmt.Errorf("no peer certificates presented by %s", hostPort)
	}

	cert := state.PeerCertificates[0]
	now := time.Now()

	timeUntil := time.Until(cert.NotAfter)
	daysUntil := int(timeUntil.Hours() / 24)
	hoursUntil := int(timeUntil.Hours())

	isExpired := now.After(cert.NotAfter)
	isExpiringSoon := !isExpired && daysUntil <= i.certWarningDays

	status := "VALID"
	if isExpired {
		status = "EXPIRED"
	} else if daysUntil <= DefaultCertCriticalDays {
		status = "CRITICAL"
	} else if isExpiringSoon {
		status = "EXPIRING_SOON"
	}

	tlsVerStr := fmt.Sprintf("0x%04x", state.Version)
	switch state.Version {
	case tls.VersionTLS10:
		tlsVerStr = "TLS 1.0"
	case tls.VersionTLS11:
		tlsVerStr = "TLS 1.1"
	case tls.VersionTLS12:
		tlsVerStr = "TLS 1.2"
	case tls.VersionTLS13:
		tlsVerStr = "TLS 1.3"
	}

	return &TLSCertReport{
		HostPort:             hostPort,
		Subject:              cert.Subject.CommonName,
		Issuer:               cert.Issuer.CommonName,
		DNSNames:             cert.DNSNames,
		NotBefore:            cert.NotBefore,
		NotAfter:             cert.NotAfter,
		DaysUntilExpiration:  daysUntil,
		HoursUntilExpiration: hoursUntil,
		IsExpired:            isExpired,
		IsExpiringSoon:       isExpiringSoon,
		Status:               status,
		SerialNumber:         cert.SerialNumber.String(),
		TLSVersion:           tlsVerStr,
		CipherSuite:          tls.CipherSuiteName(state.CipherSuite),
	}, nil
}

// ToTelemetryObservations converts ingress reports into standardized agent ResourceObservations
func (i *IngressInspector) ToTelemetryObservations(reports []IngressInspectionReport, clusterID string) []types.ResourceObservation {
	now := time.Now().UnixMilli()
	nowStr := time.Now().UTC().Format(time.RFC3339)
	observations := make([]types.ResourceObservation, 0, len(reports))

	for _, rep := range reports {
		health := "HEALTHY"
		if !rep.Healthy {
			health = "DEGRADED"
			for _, iss := range rep.Issues {
				if strings.Contains(iss, "CRITICAL") || strings.Contains(iss, "502") || strings.Contains(iss, "504") {
					health = "CRITICAL"
					break
				}
			}
		}

		specSummary := map[string]interface{}{
			"hosts":         rep.Hosts,
			"ingressClass":  rep.IngressClass,
			"tlsConfigured": rep.TLSConfigured,
		}

		statusSummary := map[string]interface{}{
			"healthy":        rep.Healthy,
			"issues":         rep.Issues,
			"tlsCerts":       rep.TLSCerts,
			"endpointProbes": rep.EndpointProbes,
		}

		conditions := make([]types.ConditionStatus, 0)
		for _, probe := range rep.EndpointProbes {
			if probe.ErrorType != ErrorNone {
				conditions = append(conditions, types.ConditionStatus{
					Type:               string(probe.ErrorType),
					Status:             "True",
					LastTransitionTime: nowStr,
					Reason:             string(probe.ErrorType),
					Message:            fmt.Sprintf("[%s] %s", probe.URL, probe.ErrorMessage),
				})
			}
		}

		for _, cert := range rep.TLSCerts {
			if cert.IsExpired || cert.IsExpiringSoon {
				condType := "TLSCertExpiringSoon"
				if cert.IsExpired {
					condType = "TLSCertExpired"
				}
				conditions = append(conditions, types.ConditionStatus{
					Type:               condType,
					Status:             "True",
					LastTransitionTime: nowStr,
					Reason:             cert.Status,
					Message:            fmt.Sprintf("Certificate for %s expires on %s (%d days left)", cert.Subject, cert.NotAfter.Format("2006-01-02"), cert.DaysUntilExpiration),
				})
			}
		}

		obs := types.ResourceObservation{
			ClusterID:     clusterID,
			Kind:          "Ingress",
			Namespace:     rep.Namespace,
			Name:          rep.Name,
			Status:        health,
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

	slog.Debug("Converted Ingress inspections to telemetry observations", "count", len(observations))
	return observations
}
