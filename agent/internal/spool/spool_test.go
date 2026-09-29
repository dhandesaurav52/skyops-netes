package spool

import (
	"errors"
	"os"
	"testing"

	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestSpoolWriteReadAck(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyops-spool-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	sp, err := NewSpool(tempDir, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}

	batch := &types.TelemetryBatch{
		BatchID:          "batch-1",
		ClusterID:        "cls-spool-1",
		Timestamp:        12345678,
		SnapshotComplete: true,
	}

	if err := sp.WriteBatch(batch); err != nil {
		t.Fatalf("failed to write batch: %v", err)
	}

	count, bytesUsed := sp.Stats()
	if count != 1 || bytesUsed == 0 {
		t.Fatalf("expected 1 file, got %d (bytes=%d)", count, bytesUsed)
	}

	readBatch, filePath, err := sp.ReadOldestBatch()
	if err != nil {
		t.Fatalf("failed to read oldest batch: %v", err)
	}

	if readBatch.BatchID != "batch-1" {
		t.Errorf("expected batch-1, got %s", readBatch.BatchID)
	}

	if readBatch.ClusterID != "cls-spool-1" {
		t.Errorf("expected cls-spool-1, got %s", readBatch.ClusterID)
	}

	if err := sp.AckBatch(filePath); err != nil {
		t.Fatalf("failed to ack batch: %v", err)
	}

	countAfter, bytesAfter := sp.Stats()
	if countAfter != 0 || bytesAfter != 0 {
		t.Fatalf("expected 0 files after ack, got %d", countAfter)
	}

	// Verify empty read
	_, _, err = sp.ReadOldestBatch()
	if err != ErrSpoolEmpty {
		t.Fatalf("expected ErrSpoolEmpty, got %v", err)
	}
}

func TestSpoolQuotaRefusesNewBatchWithoutDeletingDurableTelemetry(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "skyops-spool-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	// Max 500 bytes quota
	sp, err := NewSpool(tempDir, 500)
	if err != nil {
		t.Fatal(err)
	}

	b1 := &types.TelemetryBatch{ClusterID: "b1", Timestamp: 1000}
	b2 := &types.TelemetryBatch{ClusterID: "b2", Timestamp: 2000}
	b3 := &types.TelemetryBatch{ClusterID: "b3", Timestamp: 3000}

	if err := sp.WriteBatch(b1); err != nil {
		t.Fatal(err)
	}
	if err := sp.WriteBatch(b2); err != nil {
		t.Fatal(err)
	}
	if err := sp.WriteBatch(b3); err != ErrSpoolFull && !errors.Is(err, ErrSpoolFull) {
		t.Fatalf("expected ErrSpoolFull, got %v", err)
	}

	_, totalBytes := sp.Stats()
	if totalBytes > 500 {
		t.Errorf("spool exceeded quota: %d bytes > 500 bytes", totalBytes)
	}

	// The earliest durable batch remains available; capacity pressure never
	// silently discards a batch that has not been acknowledged.
	readBatch, _, err := sp.ReadOldestBatch()
	if err != nil {
		t.Fatalf("failed to read batch: %v", err)
	}
	if readBatch.ClusterID != "b1" {
		t.Errorf("expected first durable batch b1, got %s", readBatch.ClusterID)
	}
}
