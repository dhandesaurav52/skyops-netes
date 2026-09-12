import { IncidentEmailData } from './types';
import { IncidentSeverity } from '../../src/types/index';

/**
 * Format severity title case for subject and badges
 */
export function formatSeverityLabel(severity: IncidentSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return 'Critical';
    case 'HIGH':
      return 'High';
    case 'MEDIUM':
      return 'Medium';
    case 'LOW':
    case 'INFO':
    default:
      return 'Low';
  }
}

/**
 * Get color scheme for severity level
 */
export function getSeverityColors(severity: IncidentSeverity): {
  accent: string;
  badgeBg: string;
  badgeText: string;
  border: string;
} {
  switch (severity) {
    case 'CRITICAL':
      return {
        accent: '#e11d48',
        badgeBg: '#ffe4e6',
        badgeText: '#9f1239',
        border: '#fda4af'
      };
    case 'HIGH':
      return {
        accent: '#d97706',
        badgeBg: '#fef3c7',
        badgeText: '#92400e',
        border: '#fcd34d'
      };
    case 'MEDIUM':
      return {
        accent: '#2563eb',
        badgeBg: '#dbeafe',
        badgeText: '#1e40af',
        border: '#93c5fd'
      };
    case 'LOW':
    case 'INFO':
    default:
      return {
        accent: '#059669',
        badgeBg: '#d1fae5',
        badgeText: '#065f46',
        border: '#6ee7b7'
      };
  }
}

/**
 * Sanitize strings to avoid accidental injection or secret leaking
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Filter out any string containing sensitive tokens or credentials
 */
export function redactSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/(:\/\/[^:\/\s]+:)[^@\s]+(@)/g, '$1[REDACTED_PASSWORD]$2')
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{15,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^\s"']+["']?/gi, '$1=[REDACTED]');
}

/**
 * Generate a complete, enterprise-grade incident email dynamically from actual incident data.
 */
export function generateIncidentEmail(data: IncidentEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const { incident, clusterName, orgName, appUrl, recipientEmail, aiAnalysis, remediationState } = data;

  const severityLabel = formatSeverityLabel(incident.severity);
  const colors = getSeverityColors(incident.severity);
  const title = redactSecrets(incident.title || 'Kubernetes Workload Incident Detected');
  const subject = `[SkyOps] ${severityLabel} Incident — ${title}`;

  // Detection timestamp formatting
  const detectionDate = new Date(incident.firstSeenAt || Date.now());
  const formattedTimestamp = detectionDate.toUTCString();

  // URL to view incident in SkyOps
  const baseUrl = (appUrl || '').replace(/\/$/, '');
  const viewIncidentUrl = baseUrl
    ? `${baseUrl}/#incident=${encodeURIComponent(incident.id)}`
    : `https://skyops.ai/incidents/${encodeURIComponent(incident.id)}`;

  // Extract actual technical details
  const details = incident.technicalDetails || {};
  const namespace = incident.namespace && incident.namespace !== 'unassigned' ? incident.namespace : null;
  const resourceKind = incident.resourceKind || null;
  const resourceName = incident.resourceName || null;
  const workloadLabel = resourceKind && resourceName ? `${resourceKind}/${resourceName}` : resourceName || null;

  // Pod & Container info
  const podName = details.podName || (resourceKind === 'Pod' ? resourceName : null);
  const containerName = details.containerName || null;
  const nodeName = details.nodeName && details.nodeName !== 'unknown' ? details.nodeName : null;
  const exitCode = details.exitCode !== undefined ? details.exitCode : null;
  const restartCount = details.restartCount !== undefined ? details.restartCount : null;

  // Triggering metric / diagnostic value
  let metricValue: string | null = null;
  if (typeof details.message === 'string' && details.message.trim()) {
    metricValue = details.message;
  } else if (typeof details.reason === 'string' && details.reason.trim()) {
    metricValue = details.reason;
  }

  // Root cause / Description
  const description = redactSecrets(
    (details.rootCause as string) ||
    (details.message as string) ||
    (incident as any).description ||
    `Incident ${incident.id} detected on workload ${workloadLabel || 'in cluster'}.`
  );

  // Impact Assessment
  const impact = typeof details.impact === 'string' && details.impact.trim() ? redactSecrets(details.impact) : null;

  // Relevant Events
  const events = Array.isArray(details.events) ? details.events : [];
  const relevantEvents = events.slice(0, 3).map((e) => ({
    reason: escapeHtml(e.reason || 'Event'),
    message: escapeHtml(redactSecrets(e.message || '')),
    type: e.type || 'Warning'
  }));

  // AI Analysis (Omit if not present!)
  const hasAiAnalysis = !!aiAnalysis && (!!aiAnalysis.summary || !!aiAnalysis.rootCause);
  const aiSummary = hasAiAnalysis ? redactSecrets(aiAnalysis.summary || '') : null;
  const aiRootCause = hasAiAnalysis ? redactSecrets(aiAnalysis.rootCause || '') : null;
  const aiActions =
    hasAiAnalysis && aiAnalysis.recommendedFix
      ? [
          {
            actionType: aiAnalysis.recommendedFix.action?.type || 'REMEDIATION',
            description: aiAnalysis.recommendedFix.description + (aiAnalysis.recommendedFix.reason ? ` (${aiAnalysis.recommendedFix.reason})` : '')
          }
        ]
      : [];

  // Remediation State (Omit if not present!)
  const hasRemediation = !!remediationState && (!!remediationState.status || !!remediationState.actionType);

  // --------------------------------------------------------------------------
  // PLAIN-TEXT FALLBACK
  // --------------------------------------------------------------------------
  const textLines: string[] = [
    `======================================================================`,
    `SKYOPS INCIDENT ALERT: [${severityLabel.toUpperCase()}] ${title}`,
    `======================================================================`,
    ``,
    `Incident ID:        ${incident.id}`,
    `Severity:           ${severityLabel}`,
    `Current Status:     ${incident.status}`,
    `Cluster:            ${clusterName || incident.clusterName || 'Kubernetes Cluster'}`,
    `Organization:       ${orgName || 'SkyOps Organization'}`,
    `Detected At:        ${formattedTimestamp}`,
  ];

  if (namespace) textLines.push(`Namespace:          ${namespace}`);
  if (workloadLabel) textLines.push(`Workload:           ${workloadLabel}`);
  if (podName) textLines.push(`Pod:                ${podName}`);
  if (nodeName) textLines.push(`Node:               ${nodeName}`);
  if (containerName) textLines.push(`Container:          ${containerName}`);
  if (exitCode !== null) textLines.push(`Exit Code:          ${exitCode}`);
  if (restartCount !== null) textLines.push(`Restart Count:      ${restartCount}`);

  textLines.push(``);
  textLines.push(`----------------------------------------------------------------------`);
  textLines.push(`INCIDENT DESCRIPTION`);
  textLines.push(`----------------------------------------------------------------------`);
  textLines.push(description);

  if (impact) {
    textLines.push(``);
    textLines.push(`IMPACT ASSESSMENT:`);
    textLines.push(impact);
  }

  if (metricValue && metricValue !== description) {
    textLines.push(``);
    textLines.push(`DIAGNOSTIC TELEMETRY:`);
    textLines.push(metricValue);
  }

  if (hasAiAnalysis) {
    textLines.push(``);
    textLines.push(`----------------------------------------------------------------------`);
    textLines.push(`SKYOPS AI ROOT CAUSE ANALYSIS`);
    textLines.push(`----------------------------------------------------------------------`);
    if (aiSummary) textLines.push(aiSummary);
    if (aiRootCause && aiRootCause !== aiSummary) {
      textLines.push(``);
      textLines.push(aiRootCause);
    }
    if (aiActions.length > 0) {
      textLines.push(``);
      textLines.push(`RECOMMENDED ACTIONS:`);
      aiActions.forEach((act, idx) => {
        textLines.push(`  ${idx + 1}. [${act.actionType || 'ACTION'}] ${act.description}`);
      });
    }
  }

  if (hasRemediation) {
    textLines.push(``);
    textLines.push(`REMEDIATION STATE: ${remediationState.status || 'EVALUATED'} (${remediationState.actionType || 'AUTOMATED'})`);
  }

  textLines.push(``);
  textLines.push(`----------------------------------------------------------------------`);
  textLines.push(`VIEW INCIDENT IN SKYOPS:`);
  textLines.push(viewIncidentUrl);
  textLines.push(`----------------------------------------------------------------------`);
  textLines.push(``);
  textLines.push(`This is an automated operational alert generated by SkyOps Software Solutions.`);
  textLines.push(`Notification sent to: ${recipientEmail}`);
  textLines.push(`SkyOps Software Solutions, Inc. • Autonomous Kubernetes Reliability Platform`);

  const text = textLines.join('\n');

  // --------------------------------------------------------------------------
  // RESPONSIVE HTML EMAIL
  // --------------------------------------------------------------------------
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a; table-layout: fixed;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);">
          
          <!-- Top Brand Header -->
          <tr>
            <td style="background-color: #090d16; padding: 20px 28px; border-bottom: 3px solid ${colors.accent};">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left" style="vertical-align: middle;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color: #0284c7; width: 28px; height: 28px; border-radius: 6px; text-align: center; vertical-align: middle; color: #ffffff; font-weight: 800; font-size: 15px; letter-spacing: -0.5px;">
                          S
                        </td>
                        <td style="padding-left: 10px; color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: -0.3px;">
                          SkyOps
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align: middle; color: #94a3b8; font-size: 12px; font-weight: 500;">
                    Incident Notification
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Incident Alert Banner -->
          <tr>
            <td style="padding: 28px 28px 20px 28px; background-color: #ffffff;">
              <!-- Severity & Status Badges -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                <tr>
                  <td style="background-color: ${colors.badgeBg}; color: ${colors.badgeText}; border: 1px solid ${colors.border}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
                    <span style="display: inline-block; width: 7px; height: 7px; background-color: ${colors.accent}; border-radius: 50%; margin-right: 6px; vertical-align: middle;"></span>
                    ${escapeHtml(severityLabel)} Severity
                  </td>
                  <td style="width: 8px;"></td>
                  <td style="background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; font-family: monospace;">
                    ${escapeHtml(incident.id)}
                  </td>
                  <td style="width: 8px;"></td>
                  <td style="background-color: #f8fafc; color: #334155; border: 1px solid #e2e8f0; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                    ${escapeHtml(incident.status)}
                  </td>
                </tr>
              </table>

              <!-- Incident Title -->
              <h1 style="margin: 0 0 14px 0; color: #0f172a; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.4px;">
                ${escapeHtml(title)}
              </h1>

              <!-- Quick Summary / Description -->
              <p style="margin: 0 0 20px 0; color: #334155; font-size: 14px; line-height: 22px;">
                ${escapeHtml(description)}
              </p>

              <!-- Impact Assessment Callout if present -->
              ${impact ? `
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff1f2; border-left: 4px solid #f43f5e; border-radius: 4px; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 12px 14px;">
                    <div style="font-size: 11px; font-weight: 700; color: #9f1239; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Impact Assessment</div>
                    <div style="font-size: 13px; color: #881337; line-height: 19px;">${escapeHtml(impact)}</div>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Primary CTA Button -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center" style="border-radius: 6px; background-color: #0284c7;">
                    <a href="${escapeHtml(viewIncidentUrl)}" target="_blank" rel="noopener noreferrer" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 6px; display: inline-block; border: 1px solid #0284c7;">
                      View Incident in SkyOps &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Incident Diagnostic Telemetry Section -->
          <tr>
            <td style="padding: 0 28px 24px 28px; background-color: #ffffff;">
              <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                Incident Telemetry & Environment
              </div>

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px;">
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 34%; font-weight: 500;">Cluster</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600;">${escapeHtml(clusterName || incident.clusterName || 'Production Cluster')}</td>
                </tr>
                ${namespace ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Namespace</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-weight: 600;">${escapeHtml(namespace)}</td>
                </tr>
                ` : ''}
                ${workloadLabel ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Workload</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-weight: 600;">${escapeHtml(workloadLabel)}</td>
                </tr>
                ` : ''}
                ${podName ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Pod</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-size: 12px;">${escapeHtml(podName)}</td>
                </tr>
                ` : ''}
                ${nodeName ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Node</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-size: 12px;">${escapeHtml(nodeName)}</td>
                </tr>
                ` : ''}
                ${containerName ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Container</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-size: 12px;">${escapeHtml(containerName)}</td>
                </tr>
                ` : ''}
                ${restartCount !== null ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Restarts</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600;">${restartCount}</td>
                </tr>
                ` : ''}
                ${metricValue ? `
                <tr>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Trigger Metric</td>
                  <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-family: monospace; font-size: 12px;">${escapeHtml(metricValue)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 10px 14px; color: #64748b; font-weight: 500;">Detected At</td>
                  <td style="padding: 10px 14px; color: #334155;">${escapeHtml(formattedTimestamp)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Relevant Events if available -->
          ${relevantEvents.length > 0 ? `
          <tr>
            <td style="padding: 0 28px 24px 28px; background-color: #ffffff;">
              <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                Kubernetes Cluster Events
              </div>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                ${relevantEvents.map((evt, idx) => `
                <tr>
                  <td style="padding: 10px 14px; ${idx < relevantEvents.length - 1 ? 'border-bottom: 1px solid #e2e8f0;' : ''}">
                    <span style="display: inline-block; background-color: #fee2e2; color: #991b1b; font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">
                      ${evt.reason}
                    </span>
                    <span style="font-size: 12px; color: #334155; line-height: 18px;">
                      ${evt.message}
                    </span>
                  </td>
                </tr>
                `).join('')}
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- SkyOps AI Analysis (Only shown when available - never shown as 'None') -->
          ${hasAiAnalysis ? `
          <tr>
            <td style="padding: 0 28px 24px 28px; background-color: #ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                <tr>
                  <td style="padding: 16px 18px;">
                    <div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px;">
                      ⚡ SkyOps Autonomous AI Analysis
                    </div>
                    ${aiSummary ? `
                    <p style="margin: 0 0 10px 0; color: #14532d; font-size: 13px; line-height: 20px;">
                      ${escapeHtml(aiSummary)}
                    </p>
                    ` : ''}
                    ${aiActions.length > 0 ? `
                    <div style="font-size: 12px; font-weight: 600; color: #166534; margin-top: 10px; margin-bottom: 6px;">
                      Recommended Remediation:
                    </div>
                    <ol style="margin: 0; padding-left: 18px; color: #14532d; font-size: 13px; line-height: 20px;">
                      ${aiActions.map((act) => `
                      <li style="margin-bottom: 4px;">
                        <strong>[${escapeHtml(act.actionType || 'Action')}]</strong> ${escapeHtml(act.description)}
                      </li>
                      `).join('')}
                    </ol>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 24px 28px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; line-height: 18px;">
              <p style="margin: 0 0 8px 0;">
                This operational notification was generated automatically by <strong>SkyOps Software Solutions</strong> because Incident Email Notifications are enabled for your account.
              </p>
              <p style="margin: 0 0 12px 0;">
                Delivered to: <span style="font-family: monospace; color: #334155;">${escapeHtml(recipientEmail)}</span> | Organization: <strong>${escapeHtml(orgName || 'SkyOps')}</strong>
              </p>
              <div style="border-top: 1px solid #e2e8f0; padding-top: 12px; color: #94a3b8; font-size: 11px;">
                &copy; ${new Date().getFullYear()} SkyOps Software Solutions, Inc. &bull; Autonomous Kubernetes Reliability Platform
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
