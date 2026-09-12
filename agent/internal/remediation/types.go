package remediation

import "time"

// ActionState represents the explicit lifecycle phase of a remediation action
type ActionState string

const (
	StateProposed    ActionState = "PROPOSED"
	StateValidating  ActionState = "VALIDATING"
	StateApproved    ActionState = "APPROVED"
	StateExecuting   ActionState = "EXECUTING"
	StateVerifying   ActionState = "VERIFYING"
	StateSucceeded   ActionState = "SUCCEEDED"
	StateFailed      ActionState = "FAILED"
	StateRejected    ActionState = "REJECTED"
	StateRollingBack ActionState = "ROLLING_BACK"
	StateRolledBack  ActionState = "ROLLED_BACK"
)

// AuditLogEntry records an immutable record in the audit trail
type AuditLogEntry struct {
	Timestamp int64       `json:"timestamp"`
	FromState ActionState `json:"fromState"`
	ToState   ActionState `json:"toState"`
	Message   string      `json:"message"`
	Actor     string      `json:"actor,omitempty"`
}

// ExecutionRecord stores complete lifecycle details of a remediation action
type ExecutionRecord struct {
	ActionID       string          `json:"actionId"`
	IdempotencyKey string          `json:"idempotencyKey"`
	ActionType     string          `json:"actionType"`
	State          ActionState     `json:"state"`
	StartTime      time.Time       `json:"startTime"`
	EndTime        *time.Time      `json:"endTime,omitempty"`
	AuditLog       []AuditLogEntry `json:"auditLog"`
	PreviousState  string          `json:"previousState,omitempty"`
	ErrorMessage   string          `json:"errorMessage,omitempty"`
}
