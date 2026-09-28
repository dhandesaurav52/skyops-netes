import { Incident, IncidentSeverity, SkyOpsAIAnalysis } from '../../src/types/index';

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  duplicate?: boolean;
  timestamp: number;
}

export interface IEmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<EmailDeliveryResult>;
}

export interface IncidentEmailData {
  incident: Incident;
  clusterName: string;
  orgName: string;
  appUrl: string;
  recipientEmail: string;
  aiAnalysis?: SkyOpsAIAnalysis;
  remediationState?: {
    status?: string;
    actionType?: string;
    summary?: string;
  };
}

export type EmailDeliveryStatus = 'SENT' | 'FAILED' | 'DUPLICATE_SUPPRESSED';

export interface EmailNotificationRecord {
  id: string;
  incidentId: string;
  orgId: string;
  recipient: string;
  subject: string;
  status: EmailDeliveryStatus;
  provider: string;
  messageId?: string;
  error?: string;
  timestamp: number;
  idempotencyKey: string;
}

export interface UserNotificationSettings {
  incidentEmailEnabled: boolean;
  email: string;
  updatedAt?: number;
}
