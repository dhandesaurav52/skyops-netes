package transport

import (
	"testing"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestCircuitBreakerTrippingAndCooldown(t *testing.T) {
	cb := NewCircuitBreaker(3, 50*time.Millisecond)

	if !cb.Allow() {
		t.Fatal("expected circuit breaker to allow initially")
	}

	// Record 2 failures (under threshold)
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != StateClosed || !cb.Allow() {
		t.Fatalf("expected circuit to stay CLOSED after 2 failures, state: %s", cb.State())
	}

	// Record 3rd failure (trips threshold)
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected circuit to trip to OPEN, got %s", cb.State())
	}
	if cb.Allow() {
		t.Fatal("expected circuit breaker to reject while OPEN")
	}

	// Wait for cooldown
	time.Sleep(60 * time.Millisecond)

	// Now should transition to HALF_OPEN
	if !cb.Allow() {
		t.Fatal("expected trial request allowed after cooldown")
	}
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected state HALF_OPEN, got %s", cb.State())
	}

	// Success resets to CLOSED
	cb.RecordSuccess()
	if cb.State() != StateClosed {
		t.Fatalf("expected state CLOSED after success, got %s", cb.State())
	}
}

type mockSpooler struct {
	batches []*types.TelemetryBatch
}

func (m *mockSpooler) WriteBatch(batch *types.TelemetryBatch) error {
	m.batches = append(m.batches, batch)
	return nil
}

func TestCircuitBreaker_HalfOpenRateLimitingAndFailure(t *testing.T) {
	cb := NewCircuitBreaker(2, 20*time.Millisecond)
	cb.SetHalfOpenMaxProbes(1)

	// Trip to OPEN
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected OPEN state, got %s", cb.State())
	}

	// Wait for cooldown
	time.Sleep(25 * time.Millisecond)

	// First request transitions to HALF_OPEN and is allowed
	if !cb.Allow() {
		t.Fatal("expected first trial request allowed in HALF_OPEN")
	}
	if cb.State() != StateHalfOpen {
		t.Fatalf("expected HALF_OPEN state, got %s", cb.State())
	}

	// Controlled rate-limiting: second concurrent request should be rejected while probe is in-flight
	if cb.Allow() {
		t.Fatal("expected second request in HALF_OPEN to be rejected due to probe rate limiting")
	}

	// Failure during HALF_OPEN immediately trips back to OPEN
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected immediate transition to OPEN after failure in HALF_OPEN, got %s", cb.State())
	}
}

func TestCircuitBreaker_SpoolRedirectionWhenOpen(t *testing.T) {
	cb := NewCircuitBreaker(1, 100*time.Millisecond)
	mockSp := &mockSpooler{}
	cb.SetSpooler(mockSp)

	// Trip circuit
	cb.RecordFailure()
	if cb.State() != StateOpen {
		t.Fatalf("expected OPEN state, got %s", cb.State())
	}

	batch := &types.TelemetryBatch{
		ClusterID: "cls-circuit-redirect",
		Timestamp: time.Now().UnixMilli(),
		Items:     []interface{}{"item-1"},
	}

	// Attempt to send via ExecuteWithSpoolFallback
	sendCalled := false
	err := cb.ExecuteWithSpoolFallback(batch, func() error {
		sendCalled = true
		return nil
	})

	if err != nil {
		t.Fatalf("unexpected error from ExecuteWithSpoolFallback: %v", err)
	}
	if sendCalled {
		t.Fatal("sendFn should not have been called while circuit is OPEN")
	}
	if len(mockSp.batches) != 1 {
		t.Fatalf("expected 1 batch redirected to spool, got %d", len(mockSp.batches))
	}
	if mockSp.batches[0].ClusterID != "cls-circuit-redirect" {
		t.Errorf("expected cluster ID cls-circuit-redirect, got %s", mockSp.batches[0].ClusterID)
	}
}

