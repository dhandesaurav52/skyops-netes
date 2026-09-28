import { AuditEvent, AuditQueryFilters, PaginatedResult } from './repositories/types';
import fs from 'fs';
import crypto from 'crypto';
import { getPersistenceConfig, safeWriteJsonSync } from './persistence';
import { getPersistenceStore } from './persistence/index';

/**
 * Computes deterministic SHA-256 integrity hash for an audit event
 */
export function computeAuditHash(
  event: Omit<AuditEvent, 'hash'>,
  prevHash = ''
): string {
  const parts = [
    event.id,
    String(event.timestamp),
    event.orgId,
    event.actorId,
    event.actorName,
    event.actorType,
    event.action,
    event.resourceType,
    event.resourceId,
    event.result,
    prevHash || '',
    JSON.stringify(event.details || {})
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

class AuditService {
  private events: AuditEvent[] = [];
  private readonly dataFilePath = getPersistenceConfig().auditFile;
  private latestHashByOrg: Map<string, string> = new Map();

  constructor() {
    this.loadEvents();
  }

  public getDataFilePath(): string {
    return this.dataFilePath;
  }

  private loadEvents(): void {
    if (process.env.NODE_ENV === 'production') {
      // Production uses Cloud Firestore; local JSON is disabled
      return;
    }
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.events = parsed;
          // Hydrate hash chain state per organization
          for (const ev of this.events) {
            if (ev.orgId && ev.hash) {
              this.latestHashByOrg.set(ev.orgId, ev.hash);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[AuditService] Notice reading audit file:', err);
      this.events = [];
    }
  }

  private saveEvents(): void {
    if (process.env.NODE_ENV === 'production' || getPersistenceStore().providerName === 'firestore') {
      // No local JSON in production
      return;
    }
    try {
      safeWriteJsonSync(this.dataFilePath, this.events);
    } catch (err) {
      console.error('[AuditService] Failed to persist audit events to disk:', err);
    }
  }

  /**
   * Append-only: Record an immutable audit log entry with SHA-256 cryptographic chain
   */
  public record(
    event: Omit<AuditEvent, 'id' | 'timestamp' | 'hash' | 'prevHash'> &
      Partial<Pick<AuditEvent, 'hash' | 'prevHash'>>
  ): AuditEvent {
    const id = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();
    const prevHash = event.prevHash || this.latestHashByOrg.get(event.orgId) || '';

    const partialEvent: Omit<AuditEvent, 'hash'> = {
      ...event,
      id,
      timestamp,
      prevHash: prevHash || undefined
    };

    const hash = event.hash || computeAuditHash(partialEvent, prevHash);
    const fullEvent: AuditEvent = {
      ...partialEvent,
      hash
    };

    this.latestHashByOrg.set(event.orgId, hash);
    this.events.push(fullEvent);
    this.saveEvents();

    try {
      getPersistenceStore()
        .recordAuditEvent(fullEvent)
        .catch((err) => {
          console.error('[AuditService] Failed to asynchronously persist audit event:', err?.message || err);
        });
    } catch (e: any) {
      console.error('[AuditService] Error invoking persistence store:', e?.message || e);
    }

    return fullEvent;
  }

  /**
   * Query audit events strictly tenant-scoped with filters and pagination (Synchronous fast-path)
   */
  public query(filters: AuditQueryFilters): PaginatedResult<AuditEvent> {
    const orgId = filters.orgId;
    let list = this.events.filter((e) => e.orgId === orgId);

    if (filters.actorId) {
      list = list.filter((e) => e.actorId === filters.actorId);
    }
    if (filters.actorType) {
      const targetType = filters.actorType.toUpperCase();
      list = list.filter((e) => {
        const itemType = (e.actorType || '').toUpperCase();
        if (targetType === 'USER' || targetType === 'HUMAN') {
          return itemType === 'USER' || itemType === 'HUMAN';
        }
        return itemType === targetType;
      });
    }
    if (filters.action) {
      list = list.filter((e) => e.action.toLowerCase() === filters.action?.toLowerCase());
    }
    if (filters.resourceType) {
      list = list.filter((e) => e.resourceType.toUpperCase() === filters.resourceType?.toUpperCase());
    }
    if (filters.resourceId) {
      list = list.filter((e) => e.resourceId === filters.resourceId);
    }
    if (filters.result) {
      list = list.filter((e) => e.result === filters.result);
    }
    if (filters.fromTimestamp) {
      list = list.filter((e) => e.timestamp >= filters.fromTimestamp!);
    }
    if (filters.toTimestamp) {
      list = list.filter((e) => e.timestamp <= filters.toTimestamp!);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.action && e.action.toLowerCase().includes(q)) ||
          (e.actorName && e.actorName.toLowerCase().includes(q)) ||
          (e.actorId && e.actorId.toLowerCase().includes(q)) ||
          (e.resourceId && e.resourceId.toLowerCase().includes(q)) ||
          (e.resourceType && e.resourceType.toLowerCase().includes(q)) ||
          (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
      );
    }

    // Sort newest first
    list.sort((a, b) => b.timestamp - a.timestamp);

    const total = list.length;
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 25));
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const items = list.slice(startIndex, startIndex + limit);

    return {
      items,
      total,
      page,
      totalPages,
      limit
    };
  }

  /**
   * Asynchronous query reading from persistence store with in-memory fallback
   */
  public async queryAsync(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEvent>> {
    try {
      const storeRes = await getPersistenceStore().queryAuditEvents(filters);
      if (storeRes && storeRes.items && storeRes.items.length > 0) {
        return storeRes;
      }
    } catch (err) {
      console.warn('[AuditService] Persistence query error, using local fallback:', err);
    }
    return this.query(filters);
  }

  /**
   * Cryptographically verify ledger integrity for an organization
   */
  public async verifyIntegrity(orgId: string): Promise<{
    verified: boolean;
    totalChecked: number;
    tampered: boolean;
    tamperedCount: number;
    latestHash: string;
    details: string;
  }> {
    // Chronological order ascending
    const orgEvents = this.events
      .filter((e) => e.orgId === orgId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (orgEvents.length === 0) {
      return {
        verified: true,
        totalChecked: 0,
        tampered: false,
        tamperedCount: 0,
        latestHash: 'GENESIS',
        details: 'No audit records found for this organization.'
      };
    }

    let prevHash = '';
    let tamperedCount = 0;

    for (let i = 0; i < orgEvents.length; i++) {
      const ev = orgEvents[i];
      const computed = computeAuditHash(ev, prevHash);
      if (ev.hash && ev.hash !== computed) {
        tamperedCount++;
      }
      prevHash = ev.hash || computed;
    }

    const latest = orgEvents[orgEvents.length - 1];
    return {
      verified: tamperedCount === 0,
      totalChecked: orgEvents.length,
      tampered: tamperedCount > 0,
      tamperedCount,
      latestHash: latest.hash || prevHash,
      details:
        tamperedCount === 0
          ? `SHA-256 cryptographic chain intact. All ${orgEvents.length} recorded events verified.`
          : `Integrity verification warning: ${tamperedCount} record(s) failed hash validation.`
    };
  }

  /**
   * Aggregate high-level audit ledger statistics for tenant dashboard
   */
  public async getStats(orgId: string): Promise<{
    total: number;
    actorCounts: Record<string, number>;
    actionCategories: Record<string, number>;
    lastEventTime: number | null;
    autonomousCount: number;
    securityCount: number;
    verified: boolean;
  }> {
    const list = this.events.filter((e) => e.orgId === orgId);
    const actorCounts: Record<string, number> = {
      USER: 0,
      AGENT: 0,
      AI: 0,
      SYSTEM: 0,
      AUTOMATION: 0,
      WEBHOOK: 0
    };
    const actionCategories: Record<string, number> = {
      security: 0,
      remediation: 0,
      ai: 0,
      cluster: 0,
      billing: 0,
      other: 0
    };

    let autonomousCount = 0;
    let securityCount = 0;

    for (const e of list) {
      const at = (e.actorType || 'SYSTEM').toUpperCase();
      if (at === 'USER' || at === 'HUMAN') {
        actorCounts.USER = (actorCounts.USER || 0) + 1;
      } else if (at === 'AGENT') {
        actorCounts.AGENT = (actorCounts.AGENT || 0) + 1;
        autonomousCount++;
      } else if (at === 'AI') {
        actorCounts.AI = (actorCounts.AI || 0) + 1;
        autonomousCount++;
      } else if (at === 'AUTOMATION' || at === 'AUTONOMOUS_POLICY') {
        actorCounts.AUTOMATION = (actorCounts.AUTOMATION || 0) + 1;
        autonomousCount++;
      } else if (at === 'WEBHOOK') {
        actorCounts.WEBHOOK = (actorCounts.WEBHOOK || 0) + 1;
      } else {
        actorCounts.SYSTEM = (actorCounts.SYSTEM || 0) + 1;
      }

      const act = (e.action || '').toLowerCase();
      if (
        act.startsWith('auth.') ||
        act.startsWith('member.') ||
        act.startsWith('organization.') ||
        act.includes('token') ||
        act.includes('role')
      ) {
        actionCategories.security = (actionCategories.security || 0) + 1;
        securityCount++;
      } else if (act.startsWith('remediation.')) {
        actionCategories.remediation = (actionCategories.remediation || 0) + 1;
      } else if (act.startsWith('ai.')) {
        actionCategories.ai = (actionCategories.ai || 0) + 1;
      } else if (act.startsWith('cluster.')) {
        actionCategories.cluster = (actionCategories.cluster || 0) + 1;
      } else if (act.startsWith('billing.') || act.startsWith('subscription.')) {
        actionCategories.billing = (actionCategories.billing || 0) + 1;
      } else {
        actionCategories.other = (actionCategories.other || 0) + 1;
      }
    }

    const latest = [...list].sort((a, b) => b.timestamp - a.timestamp)[0];

    return {
      total: list.length,
      actorCounts,
      actionCategories,
      lastEventTime: latest ? latest.timestamp : null,
      autonomousCount,
      securityCount,
      verified: true
    };
  }

  /**
   * Export audit log in CSV format
   */
  public exportCsv(filters: AuditQueryFilters): string {
    const result = this.query({ ...filters, page: 1, limit: 10000 });
    const headers = [
      'Event ID',
      'Timestamp (ISO)',
      'Actor Name',
      'Actor ID',
      'Actor Type',
      'Action',
      'Resource Type',
      'Resource ID',
      'Result',
      'Integrity Hash',
      'Previous Hash',
      'Details'
    ];

    const rows = result.items.map((e) => [
      e.id,
      new Date(e.timestamp).toISOString(),
      `"${(e.actorName || '').replace(/"/g, '""')}"`,
      `"${(e.actorId || '').replace(/"/g, '""')}"`,
      e.actorType,
      `"${(e.action || '').replace(/"/g, '""')}"`,
      e.resourceType,
      `"${(e.resourceId || '').replace(/"/g, '""')}"`,
      e.result,
      `"${(e.hash || '').replace(/"/g, '""')}"`,
      `"${(e.prevHash || '').replace(/"/g, '""')}"`,
      `"${JSON.stringify(e.details || {}).replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Export audit log in JSON format
   */
  public exportJson(filters: AuditQueryFilters): AuditEvent[] {
    const result = this.query({ ...filters, page: 1, limit: 10000 });
    return result.items;
  }

  /**
   * Helper for tests: count events
   */
  public getCount(orgId?: string): number {
    if (orgId) return this.events.filter((e) => e.orgId === orgId).length;
    return this.events.length;
  }
}

export const auditService = new AuditService();

