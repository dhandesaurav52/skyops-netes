package spool

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/skyops-io/skyops/agent/internal/types"
)

var (
	ErrSpoolEmpty   = errors.New("spool is empty")
	ErrSpoolCorrupt = errors.New("spool file corrupted or failed checksum")
)

// Spool provides persistent disk-backed buffering for telemetry batches during backend outages
type Spool struct {
	mu       sync.Mutex
	dir      string
	maxBytes int64
}

type spoolEntryHeader struct {
	Magic     uint32 `json:"magic"`
	CRC32     uint32 `json:"crc32"`
	Length    int    `json:"length"`
	Timestamp int64  `json:"timestamp"`
}

const spoolMagic uint32 = 0x534B5953 // "SKYS"

func NewSpool(dir string, maxBytes int64) (*Spool, error) {
	if maxBytes <= 0 {
		maxBytes = 50 * 1024 * 1024 // 50MB default
	}

	// Try creating target directory
	if err := os.MkdirAll(dir, 0750); err != nil {
		slog.Warn("Failed to create primary spool directory; falling back to temporary spool dir", "primary", dir, "error", err)
		dir = filepath.Join(os.TempDir(), "skyops-spool")
		if err := os.MkdirAll(dir, 0750); err != nil {
			return nil, fmt.Errorf("failed to create fallback spool directory %q: %w", dir, err)
		}
	}

	// Verify directory is writable
	testFile := filepath.Join(dir, ".perm_test")
	if err := os.WriteFile(testFile, []byte("ok"), 0600); err != nil {
		slog.Warn("Primary spool directory is not writable; falling back to temporary spool dir", "primary", dir, "error", err)
		dir = filepath.Join(os.TempDir(), "skyops-spool")
		_ = os.MkdirAll(dir, 0750)
	} else {
		_ = os.Remove(testFile)
	}

	s := &Spool{
		dir:      dir,
		maxBytes: maxBytes,
	}

	// Clean up any stray .tmp files from previous ungraceful exits
	s.cleanTmpFiles()

	return s, nil
}

func (s *Spool) Dir() string {
	return s.dir
}

func (s *Spool) cleanTmpFiles() {
	files, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".tmp") {
			_ = os.Remove(filepath.Join(s.dir, f.Name()))
		}
	}
}

// WriteBatch serializes and stores a telemetry batch to disk with CRC32 integrity check
func (s *Spool) WriteBatch(batch *types.TelemetryBatch) error {
	if batch == nil {
		return nil
	}

	data, err := json.Marshal(batch)
	if err != nil {
		return fmt.Errorf("failed to marshal batch for spooling: %w", err)
	}

	checksum := crc32.ChecksumIEEE(data)
	header := spoolEntryHeader{
		Magic:     spoolMagic,
		CRC32:     checksum,
		Length:    len(data),
		Timestamp: time.Now().UnixMilli(),
	}

	headerBytes, err := json.Marshal(header)
	if err != nil {
		return err
	}

	// Format on disk: 4-byte header length + header JSON + raw data JSON
	hdrLenBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(hdrLenBytes, uint32(len(headerBytes)))

	var payload []byte
	payload = append(payload, hdrLenBytes...)
	payload = append(payload, headerBytes...)
	payload = append(payload, data...)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Enforce disk quota before write
	s.pruneOldestLocked(int64(len(payload)))

	randBytes := make([]byte, 4)
	_, _ = rand.Read(randBytes)
	randStr := hex.EncodeToString(randBytes)

	ts := time.Now().UnixNano()
	tmpPath := filepath.Join(s.dir, fmt.Sprintf("spool-%020d-%s.tmp", ts, randStr))
	finalPath := filepath.Join(s.dir, fmt.Sprintf("spool-%020d-%s.dat", ts, randStr))

	if err := os.WriteFile(tmpPath, payload, 0600); err != nil {
		return fmt.Errorf("write spool tmp file: %w", err)
	}

	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename spool file: %w", err)
	}

	return nil
}

// ReadOldestBatch retrieves the oldest available spooled batch
func (s *Spool) ReadOldestBatch() (*types.TelemetryBatch, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	datFiles, err := s.getSortedDatFilesLocked()
	if err != nil {
		return nil, "", err
	}
	if len(datFiles) == 0 {
		return nil, "", ErrSpoolEmpty
	}

	filePath := filepath.Join(s.dir, datFiles[0])
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return nil, "", fmt.Errorf("read spool file: %w", err)
	}

	if len(raw) < 4 {
		_ = os.Remove(filePath)
		return nil, "", ErrSpoolCorrupt
	}

	hdrLen := int(binary.BigEndian.Uint32(raw[:4]))
	if len(raw) < 4+hdrLen {
		_ = os.Remove(filePath)
		return nil, "", ErrSpoolCorrupt
	}

	var header spoolEntryHeader
	if err := json.Unmarshal(raw[4:4+hdrLen], &header); err != nil || header.Magic != spoolMagic {
		_ = os.Remove(filePath)
		return nil, "", ErrSpoolCorrupt
	}

	batchBytes := raw[4+hdrLen:]
	if len(batchBytes) != header.Length {
		_ = os.Remove(filePath)
		return nil, "", ErrSpoolCorrupt
	}

	if crc32.ChecksumIEEE(batchBytes) != header.CRC32 {
		_ = os.Remove(filePath)
		return nil, "", ErrSpoolCorrupt
	}

	var batch types.TelemetryBatch
	if err := json.Unmarshal(batchBytes, &batch); err != nil {
		_ = os.Remove(filePath)
		return nil, "", fmt.Errorf("unmarshal spooled batch: %w", err)
	}

	return &batch, filePath, nil
}

// AckBatch removes a successfully uploaded spooled batch file
func (s *Spool) AckBatch(filePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.Remove(filePath)
}

// Stats returns count of files and total disk bytes used
func (s *Spool) Stats() (int, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	datFiles, err := s.getSortedDatFilesLocked()
	if err != nil {
		return 0, 0
	}

	var totalBytes int64
	for _, f := range datFiles {
		if fi, err := os.Stat(filepath.Join(s.dir, f)); err == nil {
			totalBytes += fi.Size()
		}
	}
	return len(datFiles), totalBytes
}

func (s *Spool) getSortedDatFilesLocked() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var datFiles []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".dat") {
			datFiles = append(datFiles, e.Name())
		}
	}
	sort.Strings(datFiles) // Lexicographical sort on spool-%020d order by timestamp
	return datFiles, nil
}

func (s *Spool) pruneOldestLocked(neededBytes int64) {
	datFiles, err := s.getSortedDatFilesLocked()
	if err != nil {
		return
	}

	var totalBytes int64
	fileSizes := make(map[string]int64)
	for _, f := range datFiles {
		if fi, err := os.Stat(filepath.Join(s.dir, f)); err == nil {
			totalBytes += fi.Size()
			fileSizes[f] = fi.Size()
		}
	}

	// If current size + needed exceeds maxBytes, delete oldest files
	for len(datFiles) > 0 && (totalBytes+neededBytes > s.maxBytes) {
		oldest := datFiles[0]
		_ = os.Remove(filepath.Join(s.dir, oldest))
		totalBytes -= fileSizes[oldest]
		datFiles = datFiles[1:]
		slog.Warn("Pruned oldest spooled telemetry batch due to disk limit", "file", oldest)
	}
}
