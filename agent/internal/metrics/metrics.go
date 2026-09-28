package metrics

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Registry holds Prometheus-style metrics
type Registry struct {
	mu           sync.RWMutex
	startTime    time.Time
	infoLabels   map[string]string
	counters     map[string]*Counter
	gauges       map[string]*Gauge
	healthChecks map[string]func() error
}

type Counter struct {
	mu     sync.RWMutex
	values map[string]*int64
}

func newCounter() *Counter {
	return &Counter{values: make(map[string]*int64)}
}

func (c *Counter) Inc(labels map[string]string) {
	c.Add(1, labels)
}

func (c *Counter) Add(delta int64, labels map[string]string) {
	key := labelKey(labels)
	c.mu.Lock()
	valPtr, exists := c.values[key]
	if !exists {
		var v int64
		c.values[key] = &v
		valPtr = &v
	}
	c.mu.Unlock()
	atomic.AddInt64(valPtr, delta)
}

func (c *Counter) Get(labels map[string]string) int64 {
	key := labelKey(labels)
	c.mu.RLock()
	defer c.mu.RUnlock()
	valPtr, exists := c.values[key]
	if !exists {
		return 0
	}
	return atomic.LoadInt64(valPtr)
}

type Gauge struct {
	mu     sync.RWMutex
	values map[string]*int64
}

func newGauge() *Gauge {
	return &Gauge{values: make(map[string]*int64)}
}

func (g *Gauge) Set(val int64, labels map[string]string) {
	key := labelKey(labels)
	g.mu.Lock()
	valPtr, exists := g.values[key]
	if !exists {
		var v int64
		g.values[key] = &v
		valPtr = &v
	}
	g.mu.Unlock()
	atomic.StoreInt64(valPtr, val)
}

func (g *Gauge) Get(labels map[string]string) int64 {
	key := labelKey(labels)
	g.mu.RLock()
	defer g.mu.RUnlock()
	valPtr, exists := g.values[key]
	if !exists {
		return 0
	}
	return atomic.LoadInt64(valPtr)
}

func (g *Gauge) Inc(labels map[string]string) {
	key := labelKey(labels)
	g.mu.Lock()
	valPtr, exists := g.values[key]
	if !exists {
		var v int64
		g.values[key] = &v
		valPtr = &v
	}
	g.mu.Unlock()
	atomic.AddInt64(valPtr, 1)
}

func (g *Gauge) Dec(labels map[string]string) {
	key := labelKey(labels)
	g.mu.Lock()
	valPtr, exists := g.values[key]
	if !exists {
		var v int64
		g.values[key] = &v
		valPtr = &v
	}
	g.mu.Unlock()
	atomic.AddInt64(valPtr, -1)
}

func labelKey(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, fmt.Sprintf("%s=%q", k, labels[k]))
	}
	return strings.Join(pairs, ",")
}

// DefaultRegistry global singleton
var Default = NewRegistry()

func NewRegistry() *Registry {
	r := &Registry{
		startTime:    time.Now(),
		infoLabels:   make(map[string]string),
		counters:     make(map[string]*Counter),
		gauges:       make(map[string]*Gauge),
		healthChecks: make(map[string]func() error),
	}
	return r
}

func (r *Registry) SetInfo(labels map[string]string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.infoLabels = labels
}

func (r *Registry) RegisterHealthCheck(name string, check func() error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.healthChecks[name] = check
}

func (r *Registry) Counter(name string) *Counter {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, exists := r.counters[name]
	if !exists {
		c = newCounter()
		r.counters[name] = c
	}
	return c
}

func (r *Registry) Gauge(name string) *Gauge {
	r.mu.Lock()
	defer r.mu.Unlock()
	g, exists := r.gauges[name]
	if !exists {
		g = newGauge()
		r.gauges[name] = g
	}
	return g
}

// ExportPrometheus renders metrics in standard Prometheus text format
func (r *Registry) ExportPrometheus() string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var sb strings.Builder

	// Uptime
	uptime := time.Since(r.startTime).Seconds()
	sb.WriteString("# HELP skyops_agent_uptime_seconds Agent uptime in seconds\n")
	sb.WriteString("# TYPE skyops_agent_uptime_seconds gauge\n")
	sb.WriteString(fmt.Sprintf("skyops_agent_uptime_seconds %.2f\n\n", uptime))

	// Info
	if len(r.infoLabels) > 0 {
		sb.WriteString("# HELP skyops_agent_info Agent metadata and version information\n")
		sb.WriteString("# TYPE skyops_agent_info gauge\n")
		sb.WriteString(fmt.Sprintf("skyops_agent_info{%s} 1\n\n", labelKey(r.infoLabels)))
	}

	// Counters
	counterNames := make([]string, 0, len(r.counters))
	for name := range r.counters {
		counterNames = append(counterNames, name)
	}
	sort.Strings(counterNames)

	for _, name := range counterNames {
		c := r.counters[name]
		sb.WriteString(fmt.Sprintf("# TYPE %s counter\n", name))
		c.mu.RLock()
		for key, valPtr := range c.values {
			val := atomic.LoadInt64(valPtr)
			if key == "" {
				sb.WriteString(fmt.Sprintf("%s %d\n", name, val))
			} else {
				sb.WriteString(fmt.Sprintf("%s{%s} %d\n", name, key, val))
			}
		}
		c.mu.RUnlock()
		sb.WriteString("\n")
	}

	// Gauges
	gaugeNames := make([]string, 0, len(r.gauges))
	for name := range r.gauges {
		gaugeNames = append(gaugeNames, name)
	}
	sort.Strings(gaugeNames)

	for _, name := range gaugeNames {
		g := r.gauges[name]
		sb.WriteString(fmt.Sprintf("# TYPE %s gauge\n", name))
		g.mu.RLock()
		for key, valPtr := range g.values {
			val := atomic.LoadInt64(valPtr)
			if key == "" {
				sb.WriteString(fmt.Sprintf("%s %d\n", name, val))
			} else {
				sb.WriteString(fmt.Sprintf("%s{%s} %d\n", name, key, val))
			}
		}
		g.mu.RUnlock()
		sb.WriteString("\n")
	}

	return sb.String()
}

// CheckHealth runs registered health checks and returns any failures
func (r *Registry) CheckHealth() map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	results := make(map[string]string)
	for name, check := range r.healthChecks {
		if err := check(); err != nil {
			results[name] = err.Error()
		}
	}
	return results
}
