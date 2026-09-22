package inspectors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
)

// MetricType classifies the nature of the telemetry measurement
type MetricType string

const (
	MetricTypeGauge     MetricType = "GAUGE"
	MetricTypeCounter   MetricType = "COUNTER"
	MetricTypeHistogram MetricType = "HISTOGRAM"
	MetricTypeUntyped   MetricType = "UNTYPED"
	MetricTypeState     MetricType = "STATE"
)

// MetricSourceType defines how telemetry is ingested by the custom metric engine
type MetricSourceType string

const (
	SourceTypePrometheus   MetricSourceType = "PROMETHEUS"
	SourceTypeJSONFile     MetricSourceType = "JSON_FILE"
	SourceTypeHTTPJSON     MetricSourceType = "HTTP_JSON"
	SourceTypeShellCommand MetricSourceType = "SHELL_COMMAND"
)

// MetricDataPoint represents a single extracted numeric or categorical telemetry measurement
type MetricDataPoint struct {
	Name        string            `json:"name"`
	Type        MetricType        `json:"type"`
	Value       float64           `json:"value"`
	StringValue string            `json:"stringValue,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`
	Help        string            `json:"help,omitempty"`
	Timestamp   int64             `json:"timestamp"`
}

// CustomMetricTelemetryEvent encapsulates a full harvest cycle from a metric source
type CustomMetricTelemetryEvent struct {
	SourceType  MetricSourceType  `json:"sourceType"`
	SourceName  string            `json:"sourceName"`
	Target      string            `json:"target"`
	CollectedAt int64             `json:"collectedAt"`
	DurationMs  int64             `json:"durationMs"`
	Metrics     []MetricDataPoint `json:"metrics"`
	Error       string            `json:"error,omitempty"`
}

// MetricSourceConfig configures an individual custom metric probe
type MetricSourceConfig struct {
	Name       string            `json:"name"`
	SourceType MetricSourceType  `json:"sourceType"`
	Target     string            `json:"target"` // URL, file path, or shell command string
	Labels     map[string]string `json:"labels,omitempty"`
	Timeout    time.Duration     `json:"timeout,omitempty"`
	Delimiter  string            `json:"delimiter,omitempty"` // For shell key-value parsing (default "=")
}

// CustomMetricCollector coordinates extensible metric gathering across Prometheus, JSON, and CLI sources
type CustomMetricCollector struct {
	defaultTimeout time.Duration
	httpClient     *http.Client
	sourcesMu      sync.RWMutex
	sources        []MetricSourceConfig
}

// NewCustomMetricCollector creates an extensible custom metric collector engine
func NewCustomMetricCollector(defaultTimeout time.Duration) *CustomMetricCollector {
	if defaultTimeout <= 0 {
		defaultTimeout = 10 * time.Second
	}

	return &CustomMetricCollector{
		defaultTimeout: defaultTimeout,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
		sources: make([]MetricSourceConfig, 0),
	}
}

// RegisterSource registers a new telemetry probe into the collector engine
func (c *CustomMetricCollector) RegisterSource(src MetricSourceConfig) {
	c.sourcesMu.Lock()
	defer c.sourcesMu.Unlock()
	c.sources = append(c.sources, src)
}

// Sources returns a copy of all registered sources
func (c *CustomMetricCollector) Sources() []MetricSourceConfig {
	c.sourcesMu.RLock()
	defer c.sourcesMu.RUnlock()
	res := make([]MetricSourceConfig, len(c.sources))
	copy(res, c.sources)
	return res
}

// CollectAll gathers telemetry from all registered metric sources concurrently
func (c *CustomMetricCollector) CollectAll(ctx context.Context) []CustomMetricTelemetryEvent {
	sources := c.Sources()
	if len(sources) == 0 {
		return nil
	}

	var wg sync.WaitGroup
	events := make([]CustomMetricTelemetryEvent, len(sources))

	for idx, src := range sources {
		wg.Add(1)
		go func(i int, s MetricSourceConfig) {
			defer wg.Done()
			events[i] = c.CollectSource(ctx, s)
		}(idx, src)
	}

	wg.Wait()
	return events
}

// CollectSource executes an individual metric probe and parses its output
func (c *CustomMetricCollector) CollectSource(ctx context.Context, src MetricSourceConfig) CustomMetricTelemetryEvent {
	start := time.Now()
	nowMs := start.UnixMilli()

	event := CustomMetricTelemetryEvent{
		SourceType:  src.SourceType,
		SourceName:  src.Name,
		Target:      src.Target,
		CollectedAt: nowMs,
		Metrics:     make([]MetricDataPoint, 0),
	}

	timeout := src.Timeout
	if timeout <= 0 {
		timeout = c.defaultTimeout
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var points []MetricDataPoint
	var err error

	switch src.SourceType {
	case SourceTypePrometheus:
		points, err = c.collectPrometheus(probeCtx, src.Target)
	case SourceTypeHTTPJSON:
		points, err = c.collectHTTPJSON(probeCtx, src.Target, src.Name)
	case SourceTypeJSONFile:
		points, err = c.collectJSONFile(src.Target, src.Name)
	case SourceTypeShellCommand:
		points, err = c.collectShellCommand(probeCtx, src.Target, src.Delimiter)
	default:
		err = fmt.Errorf("unsupported metric source type: %s", src.SourceType)
	}

	event.DurationMs = time.Since(start).Milliseconds()

	if err != nil {
		event.Error = err.Error()
		slog.Debug("Custom metric probe failed", "source", src.Name, "type", src.SourceType, "error", err)
	} else {
		// Attach custom source labels
		if len(src.Labels) > 0 {
			for i := range points {
				if points[i].Labels == nil {
					points[i].Labels = make(map[string]string)
				}
				for k, v := range src.Labels {
					points[i].Labels[k] = v
				}
			}
		}
		event.Metrics = points
	}

	return event
}

// collectPrometheus fetches and parses Prometheus exposition metrics from an HTTP target
func (c *CustomMetricCollector) collectPrometheus(ctx context.Context, targetURL string) ([]MetricDataPoint, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request for %s: %w", targetURL, err)
	}
	req.Header.Set("Accept", "text/plain;version=0.0.4;q=0.9,*/*;q=0.1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed for %s: %w", targetURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus endpoint %s returned HTTP %d", targetURL, resp.StatusCode)
	}

	return ParsePrometheusMetrics(resp.Body)
}

// collectHTTPJSON queries an HTTP endpoint returning JSON and flattens metrics
func (c *CustomMetricCollector) collectHTTPJSON(ctx context.Context, targetURL, prefix string) ([]MetricDataPoint, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request for %s: %w", targetURL, err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed for %s: %w", targetURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("json endpoint %s returned HTTP %d", targetURL, resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return ParseJSONMetrics(bodyBytes, prefix)
}

// collectJSONFile reads and parses a local health or metric JSON file from disk
func (c *CustomMetricCollector) collectJSONFile(filePath, prefix string) ([]MetricDataPoint, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read JSON file %s: %w", filePath, err)
	}
	return ParseJSONMetrics(data, prefix)
}

// collectShellCommand executes a local shell diagnostic command and parses key-value pairs
func (c *CustomMetricCollector) collectShellCommand(ctx context.Context, commandStr, delimiter string) ([]MetricDataPoint, error) {
	if delimiter == "" {
		delimiter = "="
	}

	cmd := exec.CommandContext(ctx, "sh", "-c", commandStr)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return nil, fmt.Errorf("command execution failed (%v): %s", err, strings.TrimSpace(stderr.String()))
	}

	return ParseKeyValueStdout(stdout.String(), delimiter)
}

// ParsePrometheusMetrics parses standard Prometheus text exposition format into structured data points
func ParsePrometheusMetrics(r io.Reader) ([]MetricDataPoint, error) {
	scanner := bufio.NewScanner(r)
	now := time.Now().UnixMilli()

	helpMap := make(map[string]string)
	typeMap := make(map[string]MetricType)
	dataPoints := make([]MetricDataPoint, 0, 64)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// Comment lines: HELP or TYPE
		if strings.HasPrefix(line, "#") {
			parts := strings.Fields(line)
			if len(parts) >= 4 && parts[1] == "HELP" {
				metricName := parts[2]
				helpText := strings.Join(parts[3:], " ")
				helpMap[metricName] = helpText
			} else if len(parts) >= 4 && parts[1] == "TYPE" {
				metricName := parts[2]
				typeStr := strings.ToUpper(parts[3])
				switch typeStr {
				case "GAUGE":
					typeMap[metricName] = MetricTypeGauge
				case "COUNTER":
					typeMap[metricName] = MetricTypeCounter
				case "HISTOGRAM":
					typeMap[metricName] = MetricTypeHistogram
				default:
					typeMap[metricName] = MetricTypeUntyped
				}
			}
			continue
		}

		// Metric line: metric_name{label="val",...} value [timestamp]
		point, err := parsePrometheusMetricLine(line, now, helpMap, typeMap)
		if err == nil {
			dataPoints = append(dataPoints, point)
		}
	}

	if err := scanner.Err(); err != nil {
		return dataPoints, fmt.Errorf("error reading prometheus stream: %w", err)
	}

	return dataPoints, nil
}

// parsePrometheusMetricLine parses a single line of Prometheus exposition data
func parsePrometheusMetricLine(line string, defaultTs int64, helpMap map[string]string, typeMap map[string]MetricType) (MetricDataPoint, error) {
	var point MetricDataPoint
	point.Timestamp = defaultTs
	point.Type = MetricTypeUntyped
	point.Labels = make(map[string]string)

	openBrace := strings.Index(line, "{")
	closeBrace := strings.LastIndex(line, "}")

	var rawName string
	var remainder string

	if openBrace != -1 && closeBrace != -1 && closeBrace > openBrace {
		rawName = strings.TrimSpace(line[:openBrace])
		labelsStr := line[openBrace+1 : closeBrace]
		remainder = strings.TrimSpace(line[closeBrace+1:])

		// Parse label key-values
		parsePrometheusLabels(labelsStr, point.Labels)
	} else {
		// No labels
		parts := strings.Fields(line)
		if len(parts) < 2 {
			return point, fmt.Errorf("invalid metric line: %s", line)
		}
		rawName = parts[0]
		remainder = strings.Join(parts[1:], " ")
	}

	point.Name = rawName

	// Map help and type if registered for base metric name
	baseName := rawName
	if idx := strings.Index(baseName, "{"); idx != -1 {
		baseName = baseName[:idx]
	}
	if h, ok := helpMap[baseName]; ok {
		point.Help = h
	}
	if t, ok := typeMap[baseName]; ok {
		point.Type = t
	}

	// Parse value and optional timestamp from remainder
	fields := strings.Fields(remainder)
	if len(fields) == 0 {
		return point, fmt.Errorf("missing value in metric line: %s", line)
	}

	valStr := fields[0]
	val, err := parseNumericValue(valStr)
	if err != nil {
		return point, fmt.Errorf("failed to parse numeric value %q: %w", valStr, err)
	}
	point.Value = val

	if len(fields) >= 2 {
		if ts, err := strconv.ParseInt(fields[1], 10, 64); err == nil && ts > 0 {
			// Prometheus timestamps can be in milliseconds
			if ts < 10000000000 {
				ts = ts * 1000
			}
			point.Timestamp = ts
		}
	}

	return point, nil
}

// parsePrometheusLabels extracts key="value" pairs from Prometheus label strings
func parsePrometheusLabels(labelStr string, labels map[string]string) {
	var key strings.Builder
	var val strings.Builder
	inQuotes := false
	inKey := true

	for i := 0; i < len(labelStr); i++ {
		ch := labelStr[i]

		if ch == '"' {
			inQuotes = !inQuotes
			continue
		}

		if !inQuotes {
			if ch == '=' && inKey {
				inKey = false
				continue
			}
			if ch == ',' {
				k := strings.TrimSpace(key.String())
				v := val.String()
				if k != "" {
					labels[k] = v
				}
				key.Reset()
				val.Reset()
				inKey = true
				continue
			}
		}

		if inKey {
			key.WriteByte(ch)
		} else {
			val.WriteByte(ch)
		}
	}

	k := strings.TrimSpace(key.String())
	v := val.String()
	if k != "" {
		labels[k] = v
	}
}

// ParseJSONMetrics flattens nested JSON objects recursively into dot-separated numeric telemetry data points
func ParseJSONMetrics(jsonData []byte, rootPrefix string) ([]MetricDataPoint, error) {
	now := time.Now().UnixMilli()
	var raw interface{}
	if err := json.Unmarshal(jsonData, &raw); err != nil {
		return nil, fmt.Errorf("invalid json payload: %w", err)
	}

	dataPoints := make([]MetricDataPoint, 0, 16)
	flattenJSONValue(raw, rootPrefix, now, &dataPoints)
	return dataPoints, nil
}

// flattenJSONValue recursively walks JSON structures to generate structured metric entries
func flattenJSONValue(val interface{}, currentKey string, timestamp int64, out *[]MetricDataPoint) {
	switch v := val.(type) {
	case map[string]interface{}:
		for k, child := range v {
			nextKey := k
			if currentKey != "" {
				nextKey = currentKey + "." + k
			}
			flattenJSONValue(child, nextKey, timestamp, out)
		}
	case []interface{}:
		for idx, item := range v {
			nextKey := fmt.Sprintf("%s[%d]", currentKey, idx)
			flattenJSONValue(item, nextKey, timestamp, out)
		}
	case float64:
		*out = append(*out, MetricDataPoint{
			Name:      currentKey,
			Type:      MetricTypeGauge,
			Value:     v,
			Timestamp: timestamp,
		})
	case bool:
		boolVal := 0.0
		if v {
			boolVal = 1.0
		}
		*out = append(*out, MetricDataPoint{
			Name:        currentKey,
			Type:        MetricTypeState,
			Value:       boolVal,
			StringValue: strconv.FormatBool(v),
			Timestamp:   timestamp,
		})
	case string:
		// Attempt numeric parse if string is numeric (e.g. "42.5")
		if num, err := strconv.ParseFloat(v, 64); err == nil {
			*out = append(*out, MetricDataPoint{
				Name:      currentKey,
				Type:      MetricTypeGauge,
				Value:     num,
				Timestamp: timestamp,
			})
		} else {
			// Record categorical state metrics (e.g. "status": "OK")
			stateVal := 0.0
			upper := strings.ToUpper(strings.TrimSpace(v))
			if upper == "OK" || upper == "UP" || upper == "HEALTHY" || upper == "READY" || upper == "TRUE" {
				stateVal = 1.0
			}
			*out = append(*out, MetricDataPoint{
				Name:        currentKey,
				Type:        MetricTypeState,
				Value:       stateVal,
				StringValue: v,
				Timestamp:   timestamp,
			})
		}
	}
}

// ParseKeyValueStdout parses CLI stdout lines formatted as key=val, key: val, or space-delimited columns
func ParseKeyValueStdout(stdout string, delimiter string) ([]MetricDataPoint, error) {
	now := time.Now().UnixMilli()
	scanner := bufio.NewScanner(strings.NewReader(stdout))
	dataPoints := make([]MetricDataPoint, 0, 16)

	if delimiter == "" {
		delimiter = "="
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comment lines
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}

		var key, valStr string

		if strings.Contains(line, delimiter) {
			idx := strings.Index(line, delimiter)
			key = strings.TrimSpace(line[:idx])
			valStr = strings.TrimSpace(line[idx+len(delimiter):])
		} else if strings.Contains(line, ":") {
			idx := strings.Index(line, ":")
			key = strings.TrimSpace(line[:idx])
			valStr = strings.TrimSpace(line[idx+1:])
		} else {
			// Try space separation
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				key = fields[0]
				valStr = fields[1]
			} else {
				continue
			}
		}

		// Sanitize quotes from value string
		valStr = strings.Trim(valStr, `"'`)

		val, err := parseNumericValue(valStr)
		if err == nil {
			dataPoints = append(dataPoints, MetricDataPoint{
				Name:      key,
				Type:      MetricTypeGauge,
				Value:     val,
				Timestamp: now,
			})
		} else {
			// Save categorical string values
			stateVal := 0.0
			upper := strings.ToUpper(valStr)
			if upper == "OK" || upper == "TRUE" || upper == "UP" || upper == "ACTIVE" {
				stateVal = 1.0
			}
			dataPoints = append(dataPoints, MetricDataPoint{
				Name:        key,
				Type:        MetricTypeState,
				Value:       stateVal,
				StringValue: valStr,
				Timestamp:   now,
			})
		}
	}

	return dataPoints, nil
}

// parseNumericValue parses floats including Inf, -Inf, NaN, and scientific notation
func parseNumericValue(s string) (float64, error) {
	lower := strings.ToLower(strings.TrimSpace(s))
	switch lower {
	case "+inf", "inf":
		return math.Inf(1), nil
	case "-inf":
		return math.Inf(-1), nil
	case "nan":
		return math.NaN(), nil
	default:
		return strconv.ParseFloat(lower, 64)
	}
}

// ToTelemetryObservations transforms custom metric events into standardized agent ResourceObservations
func (c *CustomMetricCollector) ToTelemetryObservations(events []CustomMetricTelemetryEvent, clusterID string) []types.ResourceObservation {
	now := time.Now().UnixMilli()
	nowStr := time.Now().UTC().Format(time.RFC3339)
	observations := make([]types.ResourceObservation, 0, len(events))

	for _, ev := range events {
		health := "HEALTHY"
		if ev.Error != "" {
			health = "CRITICAL"
		}

		metricMap := make(map[string]interface{})
		for _, m := range ev.Metrics {
			if m.StringValue != "" {
				metricMap[m.Name] = m.StringValue
			} else {
				metricMap[m.Name] = m.Value
			}
		}

		specSummary := map[string]interface{}{
			"sourceType": ev.SourceType,
			"sourceName": ev.SourceName,
			"target":     ev.Target,
		}

		statusSummary := map[string]interface{}{
			"metricCount": len(ev.Metrics),
			"durationMs":  ev.DurationMs,
			"error":       ev.Error,
			"values":      metricMap,
		}

		conditions := make([]types.ConditionStatus, 0)
		if ev.Error != "" {
			conditions = append(conditions, types.ConditionStatus{
				Type:               "MetricCollectionFailed",
				Status:             "True",
				LastTransitionTime: nowStr,
				Reason:             "ProbeError",
				Message:            ev.Error,
			})
		}

		obs := types.ResourceObservation{
			ClusterID:     clusterID,
			Kind:          "CustomMetricProbe",
			Namespace:     "skyops-telemetry",
			Name:          fmt.Sprintf("probe-%s", strings.ToLower(ev.SourceName)),
			Status:        health,
			Health:        health,
			CreatedAt:     ev.CollectedAt,
			UpdatedAt:     now,
			ObservedAt:    now,
			SpecSummary:   specSummary,
			StatusSummary: statusSummary,
			Conditions:    conditions,
		}

		observations = append(observations, obs)
	}

	return observations
}
