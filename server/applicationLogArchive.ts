import { gzipSync } from 'zlib';
import crypto from 'crypto';
import { storageService } from './storage';
import { getPersistenceStore } from './persistence/index';
import { getPlanDefinition } from '../src/config/plans';

export interface StructuredApplicationLog {
  orgId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp?: number;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface BufferedEntry extends StructuredApplicationLog {
  timestamp: number;
}

const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_UNCOMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_BUFFER_ENTRIES = 10000;
const MAX_FAILURE_QUEUE = 3;
const RETRY_BASE_MS = 1000;

class ApplicationLogArchive {
  private buffers = new Map<string, { entries: BufferedEntry[]; bytes: number; firstAt: number; lastAt: number }>();
  private failureQueue: Array<{ orgId: string; payload: Buffer; filename: string; metadata: Record<string, string | number | boolean>; attempts: number; nextAttemptAt: number; subpath: string; retentionDays: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  append(entry: StructuredApplicationLog): void {
    if (!entry.orgId || !entry.message) return;
    const normalized: BufferedEntry = { ...entry, timestamp: entry.timestamp || Date.now() };
    const line = JSON.stringify(normalized) + '\n';
    const state = this.buffers.get(entry.orgId) || { entries: [], bytes: 0, firstAt: normalized.timestamp, lastAt: normalized.timestamp };
    state.entries.push(normalized);
    state.bytes += Buffer.byteLength(line);
    state.lastAt = normalized.timestamp;
    this.buffers.set(entry.orgId, state);

    if (state.bytes >= MAX_UNCOMPRESSED_BYTES || state.entries.length >= MAX_BUFFER_ENTRIES) {
      void this.flushOrg(entry.orgId);
    }
  }

  async flushAll(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const orgId of Array.from(this.buffers.keys())) {
        await this.flushOrg(orgId);
      }
      await this.retryFailures();
    } finally {
      this.flushing = false;
    }
  }

  async flushOrg(orgId: string): Promise<void> {
    const state = this.buffers.get(orgId);
    if (!state || state.entries.length === 0) return;
    this.buffers.delete(orgId);

    const raw = state.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    const rawBuffer = Buffer.from(raw, 'utf8');
    const compressed = gzipSync(rawBuffer, { level: 6 });
    const now = new Date(state.lastAt);
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const filename = `app-${new Date(state.firstAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json.gz`;
    const checksum = crypto.createHash('sha256').update(compressed).digest('hex');

    let retentionDays = getPlanDefinition('FREE').limits.dataRetentionDays;
    try {
      const subscription = await getPersistenceStore().getSubscription(orgId);
      if (subscription?.planId) retentionDays = getPlanDefinition(subscription.planId).limits.dataRetentionDays;
    } catch {
      // Keep the authoritative configured Free retention only when subscription
      // lookup is unavailable; do not invent a separate log-retention policy.
    }

    const metadata = {
      entryCount: state.entries.length,
      uncompressedSizeBytes: rawBuffer.length,
      compressedSizeBytes: compressed.length,
      compressionRatio: Number((compressed.length / Math.max(rawBuffer.length, 1)).toFixed(4)),
      firstTimestamp: state.firstAt,
      lastTimestamp: state.lastAt,
      checksumSha256: checksum
    };

    try {
      await storageService.uploadArtifact({
        orgId,
        category: 'logs',
        filename,
        subpath: `${yyyy}/${mm}/${dd}/${filename}`,
        buffer: compressed,
        mimeType: 'application/gzip',
        actor: { id: 'system-log-archive', name: 'SkyOps Log Archive', actorType: 'SYSTEM' },
        metadata,
        retentionDays
      });
    } catch (err) {
      // Do not retry forever in memory. Keep only a small bounded queue.
      if (this.failureQueue.length < MAX_FAILURE_QUEUE) {
        this.failureQueue.push({
          orgId,
          payload: compressed,
          filename,
          metadata,
          attempts: 0,
          nextAttemptAt: Date.now() + RETRY_BASE_MS,
          subpath: `${yyyy}/${mm}/${dd}/${filename}`,
          retentionDays
        });
      }
      console.warn('[ApplicationLogArchive] Upload failed; retained in bounded retry queue:', err instanceof Error ? err.message : err);
    }
  }

  private async retryFailures(): Promise<void> {
    const now = Date.now();
    for (let i = this.failureQueue.length - 1; i >= 0; i--) {
      const item = this.failureQueue[i];
      if (item.nextAttemptAt > now) continue;
      try {
        await storageService.uploadArtifact({
          orgId: item.orgId,
          category: 'logs',
          filename: item.filename,
          subpath: item.subpath,
          retentionDays: item.retentionDays,
          buffer: item.payload,
          mimeType: 'application/gzip',
          actor: { id: 'system-log-archive', name: 'SkyOps Log Archive', actorType: 'SYSTEM' },
          metadata: item.metadata
        });
        this.failureQueue.splice(i, 1);
      } catch (err) {
        item.attempts += 1;
        if (item.attempts >= 5) {
          this.failureQueue.splice(i, 1);
        } else {
          item.nextAttemptAt = now + Math.min(60_000, RETRY_BASE_MS * 2 ** item.attempts);
        }
      }
    }
  }
}

export const applicationLogArchive = new ApplicationLogArchive();
