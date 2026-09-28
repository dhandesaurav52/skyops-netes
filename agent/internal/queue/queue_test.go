package queue

import (
	"testing"
)

func TestBoundedQueue(t *testing.T) {
	q := NewBoundedQueue(5)

	if q.Size() != 0 {
		t.Fatalf("expected initial len 0, got %d", q.Size())
	}

	q.Push(Item{Type: "T1", Payload: "P1"})
	q.Push(Item{Type: "T2", Payload: "P2"})
	q.Push(Item{Type: "T3", Payload: "P3"})

	if q.Size() != 3 {
		t.Fatalf("expected len 3, got %d", q.Size())
	}

	items := q.PopAll()
	if len(items) != 3 {
		t.Fatalf("expected 3 items popped, got %d", len(items))
	}
	if q.Size() != 0 {
		t.Fatalf("expected len 0 after PopAll, got %d", q.Size())
	}

	// Test Requeue
	q.RequeueFront(items)
	if q.Size() != 3 {
		t.Fatalf("expected len 3 after Requeue, got %d", q.Size())
	}

	// Test Capacity Overflow protection
	q.Push(Item{Type: "T4"})
	q.Push(Item{Type: "T5"})
	q.Push(Item{Type: "T6"}) // Exceeds cap 5

	if q.Size() > 5 {
		t.Fatalf("queue exceeded maximum capacity: %d", q.Size())
	}
}
