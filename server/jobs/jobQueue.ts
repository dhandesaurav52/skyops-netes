import { systemObservability } from '../observability/metrics';

export type JobType =
  | 'WEBHOOK_DELIVERY'
  | 'PROCESS_INCIDENT_INTELLIGENCE'
  | 'METRIC_ROLLUP'
  | 'ACTION_LEASE_SWEEP'
  | 'AUDIT_INDEXING';

export interface BackgroundJob<T = any> {
  id: string;
  type: JobType;
  payload: T;
  priority?: number; // 1 to 5 (1 = highest)
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledFor: number;
  error?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export type JobHandler<T = any> = (payload: T, job: BackgroundJob<T>) => Promise<void>;

class InMemoryJobQueue {
  private queue: BackgroundJob[] = [];
  private handlers = new Map<JobType, JobHandler>();
  private isProcessing = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startWorker();
  }

  public registerHandler<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler);
  }

  public enqueue<T>(
    type: JobType,
    payload: T,
    options?: { priority?: number; delayMs?: number; maxAttempts?: number }
  ): string {
    const id = `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const scheduledFor = Date.now() + (options?.delayMs || 0);

    const job: BackgroundJob<T> = {
      id,
      type,
      payload,
      priority: options?.priority || 3,
      attempts: 0,
      maxAttempts: options?.maxAttempts || 3,
      createdAt: Date.now(),
      scheduledFor,
      status: 'PENDING'
    };

    this.queue.push(job);
    this.sortQueue();
    systemObservability.updateJobQueue(this.queue.length);
    return id;
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.scheduledFor !== b.scheduledFor) return a.scheduledFor - b.scheduledFor;
      return (a.priority || 3) - (b.priority || 3);
    });
  }

  private startWorker(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => {
      this.processNext().catch((err) => {
        console.warn('[JobQueue] Worker loop error:', err);
      });
    }, 150);
    if (typeof this.intervalTimer.unref === 'function') {
      this.intervalTimer.unref();
    }
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;

    const now = Date.now();
    const readyIdx = this.queue.findIndex((j) => j.status === 'PENDING' && j.scheduledFor <= now);
    if (readyIdx === -1) return;

    const job = this.queue[readyIdx];
    job.status = 'RUNNING';
    job.attempts++;
    this.isProcessing = true;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.warn(`[JobQueue] No handler registered for job type ${job.type}`);
      job.status = 'FAILED';
      job.error = `No handler for ${job.type}`;
      this.queue.splice(readyIdx, 1);
      systemObservability.updateJobQueue(this.queue.length, 0, 1);
      this.isProcessing = false;
      return;
    }

    try {
      await handler(job.payload, job);
      job.status = 'COMPLETED';
      this.queue.splice(readyIdx, 1);
      systemObservability.updateJobQueue(this.queue.length, 1, 0);
    } catch (err: any) {
      console.warn(`[JobQueue] Error executing job ${job.id} (${job.type}):`, err?.message || err);
      job.error = err?.message || String(err);

      if (job.attempts < job.maxAttempts) {
        job.status = 'PENDING';
        // Exponential backoff: 2s, 4s, 8s...
        const backoffMs = Math.min(30000, Math.pow(2, job.attempts) * 1000);
        job.scheduledFor = Date.now() + backoffMs;
        this.sortQueue();
      } else {
        job.status = 'FAILED';
        this.queue.splice(readyIdx, 1);
        systemObservability.updateJobQueue(this.queue.length, 0, 1);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  public getDepth(): number {
    return this.queue.length;
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

export const jobQueue = new InMemoryJobQueue();
