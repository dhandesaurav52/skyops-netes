import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import crypto from 'crypto';
import { EmailDeliveryResult, EmailMessage, IEmailProvider } from '../types';

export interface EmailProviderConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  senderEmail?: string;
  senderName?: string;
  simulateFailure?: boolean;
}

/**
 * Standard Nodemailer-backed Email Provider.
 * Sends via enterprise SMTP relay when credentials exist,
 * or securely compiles real MIME messages via Nodemailer stream transport when running in container/test environments.
 */
export class NodemailerEmailProvider implements IEmailProvider {
  public readonly name = 'nodemailer';
  private transporter: Transporter;
  private simulateFailure = false;

  constructor(config?: EmailProviderConfig) {
    this.simulateFailure = !!config?.simulateFailure;

    if (config?.smtpHost && config.smtpUser && config.smtpPass) {
      // Enterprise SMTP Configuration (e.g. Gmail App Password, SendGrid, Amazon SES, or Postmark)
      this.transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || (config.smtpSecure ? 465 : 587),
        secure: config.smtpSecure ?? (config.smtpPort === 465),
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass
        }
      });
    } else {
      // Stream transport for container development, preview, and testing environments:
      // Validates and compiles real RFC 5322 MIME messages without requiring external SMTP credentials.
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        buffer: true
      });
    }
  }

  public setSimulateFailure(fail: boolean): void {
    this.simulateFailure = fail;
  }

  public async sendEmail(message: EmailMessage): Promise<EmailDeliveryResult> {
    const timestamp = Date.now();

    if (this.simulateFailure) {
      return {
        success: false,
        provider: this.name,
        error: 'Simulated upstream SMTP connection timeout: ECONNREFUSED',
        timestamp
      };
    }

    try {
      const mailOptions: SendMailOptions = {
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          'X-SkyOps-Priority': 'high',
          'X-Auto-Response-Suppress': 'All',
          ...(message.headers || {})
        }
      };

      const info = await this.transporter.sendMail(mailOptions);

      const messageId = info.messageId || `<skyops-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@skyops.ai>`;

      return {
        success: true,
        messageId,
        provider: this.name,
        timestamp
      };
    } catch (err: any) {
      return {
        success: false,
        provider: this.name,
        error: err?.message || 'Unknown email delivery error',
        timestamp
      };
    }
  }
}
