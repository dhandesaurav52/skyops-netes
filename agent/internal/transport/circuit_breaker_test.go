package transport

import (
	"testing"
	"time"
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
