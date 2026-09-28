import { Role, IncidentStatus, IncidentSeverity } from '../../src/types/index';

export type AuditActorType =
  | 'HUMAN'
  | 'USER'
  | 'SYSTEM'
  | 'AGENT'
  | 'AI'
  | 'WEBHOOK'
  | 'AUTOMATION'
  | 'AUTONOMOUS_POLICY';

export type AuditResourceType =
  | 'CLUSTER'
  | 'INCIDENT'
  | 'REMEDIATION'
  | 'POLICY'
  | 'ORGANIZATION'
  | 'TEAM'
  | 'INTEGRATION'
  | 'AUTH'
  | 'SUPPORT_TICKET'
  | 'SUBSCRIPTION'
  | 'INVOICE'
  | 'AI'
  | 'SETTINGS'
  | string;

/**
 * Immutable Enterprise Audit Event Record
 */
export interface AuditEvent {
  id: string;
  timestamp: number;
  orgId: string;
  actorId: string;
  actorName: string;
  actorType: AuditActorType;
  action: string;
  resourceType: AuditResourceType;
  resourceId: string;
  result: 'SUCCESS' | 'FAILURE';
  details?: Record<string, unknown>;
  correlationId?: string;
  ipAddress?: string;
  hash: string;
  prevHash?: string;
}

export interface AuditQueryFilters {
  orgId: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'SUCCESS' | 'FAILURE';
  fromTimestamp?: number;
  toTimestamp?: number;
  search?: string;
  limit?: number;
  page?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

/**
 * Webhook and Outbound Integration Models
 */
export type WebhookEventType =
  | 'incident.created'
  | 'incident.resolved'
  | 'remediation.proposed'
  | 'remediation.approved'
  | 'remediation.executed'
  | 'remediation.verified'
  | 'cluster.registered'
  | 'cluster.disconnected'
  | '*';

export interface WebhookConfig {
  id: string;
  orgId: string;
  name: string;
  url: string;
  secret: string; // Secret for HMAC-SHA256 signature
  enabledEvents: WebhookEventType[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastDeliveredAt?: number;
  lastDeliveryStatus?: 'SUCCESS' | 'FAILURE';
}

export interface WebhookDeliveryRecord {
  id: string;
  webhookId: string;
  orgId: string;
  event: WebhookEventType;
  payload: Record<string, unknown>;
  statusCode?: number;
  responseBody?: string;
  attempts: number;
  success: boolean;
  error?: string;
  durationMs: number;
  timestamp: number;
}

/**
 * Service Account / Machine API Credential Model
 */
export interface ApiCredential {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  keyPrefix: string; // e.g. "sky_live_abc"
  hashedSecret: string;
  scopes: string[]; // e.g. ["cluster:read", "incident:read"]
  createdByUserId: string;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

/**
 * Organization Usage Tracking Record
 */
export interface OrgUsageSummary {
  orgId: string;
  period: string; // e.g. "2026-09"
  totalClusters: number;
  totalNodes: number;
  totalWorkloads: number;
  telemetryBatchesIngested: number;
  telemetryResourcesIngested: number;
  incidentsDetected: number;
  incidentsResolved: number;
  remediationsExecuted: number;
  aiAnalysesPerformed: number;
  auditEventsRecorded: number;
  lastUpdated: number;
}
