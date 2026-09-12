package spool

import (
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

func TestSpoolQuotaPruning(t *testing.T) {
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

	_ = sp.WriteBatch(b1)
	_ = sp.WriteBatch(b2)
	_ = sp.WriteBatch(b3)

	_, totalBytes := sp.Stats()
	if totalBytes > 500 {
		t.Errorf("spool exceeded quota: %d bytes > 500 bytes", totalBytes)
	}

	// Should read the latest available (oldest unpruned)
	readBatch, _, err := sp.ReadOldestBatch()
	if err != nil {
		t.Fatalf("failed to read batch: %v", err)
	}
	if readBatch.ClusterID == "b1" {
		t.Errorf("expected b1 to have been pruned, but read it")
	}
}
