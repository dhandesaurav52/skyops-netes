import { AuditEvent, AuditQueryFilters, PaginatedResult } from './repositories/types';
import fs from 'fs';
import path from 'path';

class AuditService {
  private events: AuditEvent[] = [];
  private readonly dataFilePath = path.join(process.cwd(), 'data', 'skyops_audit.json');

  constructor() {
    this.loadEvents();
  }

  private loadEvents(): void {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.events = parsed;
        }
      }
    } catch (err) {
      console.warn('[AuditService] Notice reading audit file:', err);
      this.events = [];
    }
  }

  private saveEvents(): void {
    try {
      const dir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataFilePath, JSON.stringify(this.events, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AuditService] Failed to persist audit events to disk:', err);
    }
  }

  /**
   * Append-only: Record an immutable audit log entry
   */
  public record(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const id = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const fullEvent: AuditEvent = {
      ...event,
      id,
      timestamp: Date.now()
    };

    this.events.push(fullEvent);
    this.saveEvents();
    return fullEvent;
  }

  /**
   * Query audit events strictly tenant-scoped with filters and pagination
   */
  public query(filters: AuditQueryFilters): PaginatedResult<AuditEvent> {
    const orgId = filters.orgId;
    let list = this.events.filter((e) => e.orgId === orgId);

    if (filters.actorId) {
      list = list.filter((e) => e.actorId === filters.actorId);
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
          e.action.toLowerCase().includes(q) ||
          e.actorName.toLowerCase().includes(q) ||
          e.resourceId.toLowerCase().includes(q) ||
          (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
      );
    }

    // Sort newest first
    list.sort((a, b) => b.timestamp - a.timestamp);

    const total = list.length;
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
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
   * Export audit log in CSV format
   */
  public exportCsv(filters: AuditQueryFilters): string {
    const result = this.query({ ...filters, page: 1, limit: 10000 });
    const headers = ['ID', 'Timestamp', 'Actor Name', 'Actor Type', 'Action', 'Resource Type', 'Resource ID', 'Result', 'Details'];
    
    const rows = result.items.map((e) => [
      e.id,
      new Date(e.timestamp).toISOString(),
      `"${e.actorName.replace(/"/g, '""')}"`,
      e.actorType,
      `"${e.action.replace(/"/g, '""')}"`,
      e.resourceType,
      `"${e.resourceId.replace(/"/g, '""')}"`,
      e.result,
      `"${JSON.stringify(e.details || {}).replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
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
