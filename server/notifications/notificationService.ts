import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Incident, SkyOpsAIAnalysis } from '../../src/types/index';
import { generateIncidentEmail } from './emailTemplate';
import { NodemailerEmailProvider } from './providers/emailProvider';
import {
  EmailDeliveryResult,
  EmailNotificationRecord,
  IEmailProvider,
  UserNotificationSettings
} from './types';

export interface NotificationServiceOptions {
  provider?: IEmailProvider;
  senderEmail?: string;
  senderName?: string;
  appUrl?: string;
  storagePath?: string;
}

export class IncidentNotificationService {
  private provider: IEmailProvider;
  private senderEmail: string;
  private senderName: string;
  private appUrl: string;
  private storagePath: string;

  // In-memory idempotency cache: idempotencyKey -> timestamp
  private sentKeys: Map<string, { timestamp: number; messageId?: string }> = new Map();

  // Delivery log history
  private deliveryHistory: EmailNotificationRecord[] = [];

  constructor(options?: NotificationServiceOptions) {
    this.senderEmail = options?.senderEmail || process.env.SKYOPS_NOTIFICATION_SENDER_EMAIL || 'skyopsnetes2000@gmail.com';
    this.senderName = options?.senderName || process.env.SKYOPS_NOTIFICATION_SENDER_NAME || 'SkyOps';
    this.appUrl = options?.appUrl || process.env.APP_URL || process.env.SKYOPS_SERVER_URL || 'http://localhost:3000';
    this.storagePath = options?.storagePath || path.join(process.cwd(), 'data', 'skyops_notification_logs.json');

    if (options?.provider) {
      this.provider = options.provider;
    } else {
      this.provider = new NodemailerEmailProvider({
        smtpHost: process.env.SKYOPS_SMTP_HOST,
        smtpPort: process.env.SKYOPS_SMTP_PORT ? parseInt(process.env.SKYOPS_SMTP_PORT, 10) : undefined,
        smtpSecure: process.env.SKYOPS_SMTP_SECURE === 'true' || process.env.SKYOPS_SMTP_SECURE === '1',
        smtpUser: process.env.SKYOPS_SMTP_USER,
        smtpPass: process.env.SKYOPS_SMTP_PASS
      });
    }

    this.loadLogs();
  }

  /**
   * Returns the formatted RFC 5322 sender string.
   * e.g. "SkyOps <skyopsnetes2000@gmail.com>"
   * Migrates seamlessly to "SkyOps <alerts@skyops.ai>" via server environment configuration.
   */
  public getSender(): string {
    const email = process.env.SKYOPS_NOTIFICATION_SENDER_EMAIL || this.senderEmail;
    const name = process.env.SKYOPS_NOTIFICATION_SENDER_NAME || this.senderName;
    return `${name} <${email}>`;
  }

  public setProvider(provider: IEmailProvider): void {
    this.provider = provider;
  }

  public getProvider(): IEmailProvider {
    return this.provider;
  }

  /**
   * Generate a deterministic idempotency key for an incident delivery attempt.
   */
  public generateIdempotencyKey(incidentId: string, recipient: string, notificationType = 'incident_created'): string {
    return `${incidentId}:${recipient.trim().toLowerCase()}:${notificationType}`;
  }

  /**
   * Dispatch incident email notifications to all authorized members of the organization
   * who have enabled: Settings → Notifications → Incident Email Notifications = ON
   *
   * @param incident The newly detected or created incident
   * @param context Additional context including organization members and user preferences
   */
  public async dispatchIncidentNotification(
    incident: Incident,
    context: {
      orgName: string;
      recipients: Array<{
        userId: string;
        email: string;
        name?: string;
        incidentEmailEnabled: boolean;
      }>;
      aiAnalysis?: SkyOpsAIAnalysis;
      remediationState?: {
        status?: string;
        actionType?: string;
        summary?: string;
      };
    }
  ): Promise<EmailDeliveryResult[]> {
    const results: EmailDeliveryResult[] = [];
    const notificationType = 'incident_created';

    for (const recipientInfo of context.recipients) {
      // 1. Check user notification preference
      if (!recipientInfo.incidentEmailEnabled) {
        // User opted out or has not enabled incident email notifications: DO NOT SEND
        continue;
      }

      const recipientEmail = recipientInfo.email.trim();
      if (!recipientEmail || !recipientEmail.includes('@')) {
        continue;
      }

      // 2. Duplicate Protection (Idempotency)
      const idempotencyKey = this.generateIdempotencyKey(incident.id, recipientEmail, notificationType);
      if (this.sentKeys.has(idempotencyKey)) {
        const existing = this.sentKeys.get(idempotencyKey)!;
        const duplicateResult: EmailDeliveryResult = {
          success: true,
          duplicate: true,
          messageId: existing.messageId,
          provider: this.provider.name,
          timestamp: Date.now()
        };
        results.push(duplicateResult);

        this.recordDelivery({
          id: `del-${crypto.randomBytes(6).toString('hex')}`,
          incidentId: incident.id,
          orgId: incident.orgId,
          recipient: recipientEmail,
          subject: `[Duplicate Suppressed] ${incident.title}`,
          status: 'DUPLICATE_SUPPRESSED',
          provider: this.provider.name,
          messageId: existing.messageId,
          timestamp: Date.now(),
          idempotencyKey
        });

        continue;
      }

      // 3. Generate Incident Email dynamically from real incident data
      const emailContent = generateIncidentEmail({
        incident,
        clusterName: incident.clusterName,
        orgName: context.orgName,
        appUrl: this.appUrl,
        recipientEmail,
        aiAnalysis: context.aiAnalysis,
        remediationState: context.remediationState
      });

      // 4. Attempt server-side delivery
      try {
        const deliveryResult = await this.provider.sendEmail({
          from: this.getSender(),
          to: recipientEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text
        });

        if (deliveryResult.success) {
          this.sentKeys.set(idempotencyKey, {
            timestamp: deliveryResult.timestamp,
            messageId: deliveryResult.messageId
          });

          this.recordDelivery({
            id: `del-${crypto.randomBytes(6).toString('hex')}`,
            incidentId: incident.id,
            orgId: incident.orgId,
            recipient: recipientEmail,
            subject: emailContent.subject,
            status: 'SENT',
            provider: deliveryResult.provider,
            messageId: deliveryResult.messageId,
            timestamp: deliveryResult.timestamp,
            idempotencyKey
          });
        } else {
          this.recordDelivery({
            id: `del-${crypto.randomBytes(6).toString('hex')}`,
            incidentId: incident.id,
            orgId: incident.orgId,
            recipient: recipientEmail,
            subject: emailContent.subject,
            status: 'FAILED',
            provider: deliveryResult.provider,
            error: deliveryResult.error,
            timestamp: deliveryResult.timestamp,
            idempotencyKey
          });
        }

        results.push(deliveryResult);
      } catch (err: any) {
        const failResult: EmailDeliveryResult = {
          success: false,
          provider: this.provider.name,
          error: err?.message || 'Email delivery threw unhandled exception',
          timestamp: Date.now()
        };

        this.recordDelivery({
          id: `del-${crypto.randomBytes(6).toString('hex')}`,
          incidentId: incident.id,
          orgId: incident.orgId,
          recipient: recipientEmail,
          subject: emailContent.subject,
          status: 'FAILED',
          provider: this.provider.name,
          error: failResult.error,
          timestamp: Date.now(),
          idempotencyKey
        });

        results.push(failResult);
      }
    }

    return results;
  }

  /**
   * Send a test incident notification email to the authenticated user.
   */
  public async sendTestNotification(
    recipientEmail: string,
    orgName: string,
    orgId: string
  ): Promise<EmailDeliveryResult> {
    const testIncident: Incident = {
      id: `SKY-TEST-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      fingerprint: `test-fp-${Date.now()}`,
      orgId,
      clusterId: 'test-cluster-01',
      clusterName: 'production-us-east-1',
      namespace: 'production',
      resourceKind: 'Pod',
      resourceName: 'payments-api-7b8f95c-k2m9x',
      incidentType: 'CrashLoopBackOff',
      title: 'High CPU on payments-api',
      severity: 'HIGH',
      status: 'OPEN',
      occurrenceCount: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
      technicalDetails: {
        podName: 'payments-api-7b8f95c-k2m9x',
        containerName: 'payments-api',
        nodeName: 'k8s-node-worker-01',
        restartCount: 3,
        exitCode: 137,
        reason: 'ResourceExhaustion',
        message: 'Container payments-api cpu usage reached 99.0% of limit (495m/500m). CPU throttling throttled 84% of execution periods.',
        impact: 'Payment checkout transaction latency elevated by 350ms with 4.2% timeout rate due to CPU starvation.',
        rootCause: 'Under-provisioned CPU limits during traffic surge; container experiencing CPU throttling and starvation.'
      },
      aiAnalysis: {
        incidentId: 'test-incident-id',
        summary: 'Autonomous SkyOps diagnostics identified severe CPU throttling and starvation on payments-api workload.',
        rootCause: 'The container CPU limit of 500m is inadequate for peak transaction volume, causing thread throttling.',
        confidence: 0.96,
        evidence: [],
        affectedResources: [],
        recommendedFix: {
          description: 'Scale container cpu limit from 500m to 1500m and configure HorizontalPodAutoscaler.',
          reason: 'Eliminates CFS quota throttling and thread stalling during peak payments traffic.',
          risk: 'LOW',
          expectedImpact: 'Zero downtime rolling pod update.',
          rollback: 'kubectl rollout undo deployment/payments-api',
          action: {
            type: 'RESOURCE_RESIZING'
          }
        },
        saferAlternative: {
          description: 'Add 2 additional replicas to spread request load',
          reason: 'Distributes traffic horizontally without modifying resource limits.'
        },
        requiresApproval: false,
        additionalEvidenceNeeded: [],
        analyzedAt: Date.now(),
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        status: 'SUCCESS',
        executionSafe: true
      }
    };

    const emailContent = generateIncidentEmail({
      incident: testIncident,
      clusterName: 'production-us-east-1',
      orgName,
      appUrl: this.appUrl,
      recipientEmail,
      aiAnalysis: testIncident.aiAnalysis
    });

    const idempotencyKey = `test-${Date.now()}:${recipientEmail}:test_notification`;

    const result = await this.provider.sendEmail({
      from: this.getSender(),
      to: recipientEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text
    });

    this.recordDelivery({
      id: `del-${crypto.randomBytes(6).toString('hex')}`,
      incidentId: testIncident.id,
      orgId,
      recipient: recipientEmail,
      subject: emailContent.subject,
      status: result.success ? 'SENT' : 'FAILED',
      provider: result.provider,
      messageId: result.messageId,
      error: result.error,
      timestamp: result.timestamp,
      idempotencyKey
    });

    return result;
  }

  public getDeliveries(orgId: string, recipient?: string): EmailNotificationRecord[] {
    let list = this.deliveryHistory.filter((d) => d.orgId === orgId);
    if (recipient) {
      list = list.filter((d) => d.recipient.toLowerCase() === recipient.toLowerCase());
    }
    return list.slice(0, 50);
  }

  private recordDelivery(record: EmailNotificationRecord): void {
    this.deliveryHistory.unshift(record);
    if (this.deliveryHistory.length > 200) {
      this.deliveryHistory.pop();
    }
    this.persistLogs();
  }

  private loadLogs(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.deliveries)) {
          this.deliveryHistory = data.deliveries;
        }
        if (Array.isArray(data.sentKeys)) {
          for (const item of data.sentKeys) {
            this.sentKeys.set(item.key, { timestamp: item.timestamp, messageId: item.messageId });
          }
        }
      }
    } catch (err) {
      // Non-fatal, will initialize clean in-memory log
    }
  }

  private persistLogs(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        deliveries: this.deliveryHistory.slice(0, 200),
        sentKeys: Array.from(this.sentKeys.entries()).map(([key, val]) => ({
          key,
          timestamp: val.timestamp,
          messageId: val.messageId
        }))
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Non-fatal
    }
  }
}

export const incidentNotificationService = new IncidentNotificationService();
