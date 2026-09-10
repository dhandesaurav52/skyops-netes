import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { WebhookConfig, WebhookDeliveryRecord, WebhookEventType } from '../repositories/types';
import { jobQueue } from '../jobs/jobQueue';

class WebhookService {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveryHistory: WebhookDeliveryRecord[] = [];
  private readonly dataFilePath = path.join(process.cwd(), 'data', 'skyops_webhooks.json');

  constructor() {
    this.loadWebhooks();
    this.registerJobHandler();
  }

  private loadWebhooks(): void {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.webhooks)) {
          for (const wh of parsed.webhooks) {
            this.webhooks.set(wh.id, wh);
          }
        }
        if (parsed && Array.isArray(parsed.deliveryHistory)) {
          this.deliveryHistory = parsed.deliveryHistory.slice(-500); // keep last 500
        }
      }
    } catch (err) {
      console.warn('[WebhookService] Notice loading webhooks:', err);
    }
  }

  private saveWebhooks(): void {
    try {
      const dir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        webhooks: Array.from(this.webhooks.values()),
        deliveryHistory: this.deliveryHistory.slice(-200)
      };
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[WebhookService] Failed to persist webhooks:', err);
    }
  }

  private registerJobHandler(): void {
    jobQueue.registerHandler<{
      deliveryId: string;
      webhookId: string;
      orgId: string;
      event: WebhookEventType;
      payload: Record<string, unknown>;
    }>('WEBHOOK_DELIVERY', async (data) => {
      await this.executeDelivery(data);
    });
  }

  public getWebhooks(orgId: string): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter((wh) => wh.orgId === orgId);
  }

  public getWebhook(id: string, orgId: string): WebhookConfig | null {
    const wh = this.webhooks.get(id);
    if (!wh || wh.orgId !== orgId) return null;
    return wh;
  }

  public createWebhook(
    orgId: string,
    params: { name: string; url: string; secret?: string; enabledEvents?: WebhookEventType[] }
  ): WebhookConfig {
    const id = `wh-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const secret = params.secret || crypto.randomBytes(24).toString('hex');
    const enabledEvents: WebhookEventType[] = params.enabledEvents && params.enabledEvents.length > 0 ? params.enabledEvents : ['*'];

    const wh: WebhookConfig = {
      id,
      orgId,
      name: params.name,
      url: params.url,
      secret,
      enabledEvents,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.webhooks.set(id, wh);
    this.saveWebhooks();
    return wh;
  }

  public updateWebhook(
    id: string,
    orgId: string,
    updates: Partial<Pick<WebhookConfig, 'name' | 'url' | 'secret' | 'enabledEvents' | 'isActive'>>
  ): WebhookConfig | null {
    const wh = this.getWebhook(id, orgId);
    if (!wh) return null;

    if (updates.name !== undefined) wh.name = updates.name;
    if (updates.url !== undefined) wh.url = updates.url;
    if (updates.secret !== undefined) wh.secret = updates.secret;
    if (updates.enabledEvents !== undefined) wh.enabledEvents = updates.enabledEvents;
    if (updates.isActive !== undefined) wh.isActive = updates.isActive;
    wh.updatedAt = Date.now();

    this.webhooks.set(id, wh);
    this.saveWebhooks();
    return wh;
  }

  public deleteWebhook(id: string, orgId: string): boolean {
    const wh = this.getWebhook(id, orgId);
    if (!wh) return false;
    this.webhooks.delete(id);
    this.saveWebhooks();
    return true;
  }

  /**
   * Dispatch an event to all active webhooks subscribed in the organization
   */
  public dispatchEvent(orgId: string, event: WebhookEventType, payload: Record<string, unknown>): void {
    const matching = Array.from(this.webhooks.values()).filter(
      (wh) => wh.orgId === orgId && wh.isActive && (wh.enabledEvents.includes(event) || wh.enabledEvents.includes('*'))
    );

    for (const wh of matching) {
      const deliveryId = `del-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      jobQueue.enqueue(
        'WEBHOOK_DELIVERY',
        {
          deliveryId,
          webhookId: wh.id,
          orgId,
          event,
          payload
        },
        { priority: 2, maxAttempts: 3 }
      );
    }
  }

  /**
   * Test a webhook delivery immediately
   */
  public async testWebhook(id: string, orgId: string): Promise<{ success: boolean; message: string; statusCode?: number }> {
    const wh = this.getWebhook(id, orgId);
    if (!wh) {
      return { success: false, message: 'Webhook configuration not found' };
    }

    const testPayload = {
      specVersion: '1.0',
      event: 'test.ping',
      timestamp: Date.now(),
      orgId,
      data: {
        message: 'SkyOps Webhook integration test ping',
        webhookId: wh.id,
        webhookName: wh.name
      }
    };

    const deliveryId = `test-${Date.now()}`;
    const result = await this.deliverPayload(wh, 'test.ping' as WebhookEventType, testPayload, deliveryId);
    return {
      success: result.success,
      message: result.success
        ? `Delivered test event to ${wh.url} (Status: ${result.statusCode || 200})`
        : `Delivery failed: ${result.error || 'Connection error'}`,
      statusCode: result.statusCode
    };
  }

  private async executeDelivery(data: {
    deliveryId: string;
    webhookId: string;
    orgId: string;
    event: WebhookEventType;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const wh = this.webhooks.get(data.webhookId);
    if (!wh || !wh.isActive) return;

    const fullPayload = {
      specVersion: '1.0',
      id: data.deliveryId,
      event: data.event,
      timestamp: Date.now(),
      orgId: data.orgId,
      data: data.payload
    };

    const record = await this.deliverPayload(wh, data.event, fullPayload, data.deliveryId);
    this.deliveryHistory.push(record);
    if (this.deliveryHistory.length > 200) {
      this.deliveryHistory.shift();
    }

    wh.lastDeliveredAt = record.timestamp;
    wh.lastDeliveryStatus = record.success ? 'SUCCESS' : 'FAILURE';
    this.saveWebhooks();

    if (!record.success) {
      throw new Error(`Webhook delivery to ${wh.url} failed: ${record.error}`);
    }
  }

  private async deliverPayload(
    wh: WebhookConfig,
    event: WebhookEventType,
    payload: Record<string, unknown>,
    deliveryId: string
  ): Promise<WebhookDeliveryRecord> {
    const bodyStr = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', wh.secret).update(bodyStr).digest('hex');
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SkyOps-Webhook-Dispatcher/1.0',
          'X-SkyOps-Event': event,
          'X-SkyOps-Delivery': deliveryId,
          'X-SkyOps-Signature': `sha256=${signature}`
        },
        body: bodyStr,
        signal: controller.signal
      });

      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      const success = res.status >= 200 && res.status < 300;

      return {
        id: deliveryId,
        webhookId: wh.id,
        orgId: wh.orgId,
        event,
        payload,
        statusCode: res.status,
        durationMs,
        attempts: 1,
        success,
        error: success ? undefined : `HTTP ${res.status} ${res.statusText}`,
        timestamp: Date.now()
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      return {
        id: deliveryId,
        webhookId: wh.id,
        orgId: wh.orgId,
        event,
        payload,
        durationMs,
        attempts: 1,
        success: false,
        error: err.name === 'AbortError' ? 'Connection timed out (8000ms)' : err.message || 'Network error',
        timestamp: Date.now()
      };
    }
  }

  public getDeliveries(orgId: string, webhookId?: string): WebhookDeliveryRecord[] {
    let list = this.deliveryHistory.filter((d) => d.orgId === orgId);
    if (webhookId) {
      list = list.filter((d) => d.webhookId === webhookId);
    }
    return list.sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const webhookService = new WebhookService();
