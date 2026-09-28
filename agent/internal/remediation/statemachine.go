package remediation

import (
	"fmt"
	"sync"
	"time"
)

// StateMachine enforces valid state transitions and appends to an immutable audit log
type StateMachine struct {
	mu     sync.Mutex
	record *ExecutionRecord
}

func NewStateMachine(actionID, idempotencyKey, actionType string) *StateMachine {
	return &StateMachine{
		record: &ExecutionRecord{
			ActionID:       actionID,
			IdempotencyKey: idempotencyKey,
			ActionType:     actionType,
			State:          StateProposed,
			StartTime:      time.Now(),
			AuditLog: []AuditLogEntry{
				{
					Timestamp: time.Now().UnixMilli(),
					FromState: "",
					ToState:   StateProposed,
					Message:   "Remediation action proposed",
				},
			},
		},
	}
}

func (sm *StateMachine) State() ActionState {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.record.State
}

func (sm *StateMachine) Record() ExecutionRecord {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	// Return copy
	rec := *sm.record
	rec.AuditLog = append([]AuditLogEntry(nil), sm.record.AuditLog...)
	return rec
}

// Transition moves to the next state if valid according to the formal state diagram
func (sm *StateMachine) Transition(next ActionState, message string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	curr := sm.record.State

	// Validate valid transition
	valid := false
	switch curr {
	case StateProposed:
		valid = (next == StateValidating || next == StateRejected)
	case StateValidating:
		valid = (next == StateApproved || next == StateRejected || next == StateFailed)
	case StateApproved:
		valid = (next == StateExecuting || next == StateFailed)
	case StateExecuting:
		valid = (next == StateVerifying || next == StateRollingBack || next == StateFailed)
	case StateVerifying:
		valid = (next == StateSucceeded || next == StateRollingBack || next == StateFailed)
	case StateRollingBack:
		valid = (next == StateRolledBack || next == StateFailed)
	case StateSucceeded, StateFailed, StateRejected, StateRolledBack:
		// Terminal states
		valid = false
	}

	if !valid {
		return fmt.Errorf("illegal state transition from %s to %s", curr, next)
	}

	sm.record.State = next
	sm.record.AuditLog = append(sm.record.AuditLog, AuditLogEntry{
		Timestamp: time.Now().UnixMilli(),
		FromState: curr,
		ToState:   next,
		Message:   message,
	})

	if next == StateSucceeded || next == StateFailed || next == StateRejected || next == StateRolledBack {
		now := time.Now()
		sm.record.EndTime = &now
		if next == StateFailed {
			sm.record.ErrorMessage = message
		}
	}

	return nil
}
