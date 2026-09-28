import { jsPDF } from 'jspdf';
import type { jsPDF as JsPDFType } from 'jspdf';
import * as jspdfModule from 'jspdf';
import { Incident, IncidentNote, TimelineEvent } from '../types/index';

/**
 * Maps severity to standard SRE Priority
 */
export const getPriorityLabel = (severity: string): string => {
  switch (severity) {
    case 'CRITICAL':
      return 'P1 - Critical';
    case 'HIGH':
      return 'P2 - High';
    case 'MEDIUM':
      return 'P3 - Moderate';
    case 'LOW':
      return 'P4 - Low';
    case 'INFO':
    default:
      return 'P5 - Planning';
  }
};

/**
 * Format timestamp into readable localized UTC/ISO string
 */
export const formatReportDate = (ts?: number | null): string => {
  if (!ts) return 'Not available';
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  });
};

/**
 * Format duration between two timestamps
 */
export const formatDuration = (start: number, end?: number | null): string => {
  if (!end) return 'Ongoing (Active)';
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  if (diffSec < 60) return `${diffSec} seconds`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return `${diffHours}h ${remMin}m`;
};

export interface GeneratePdfOptions {
  incident: Incident;
  timeline: TimelineEvent[];
  notes?: IncidentNote[];
}

/**
 * Generates a comprehensive, professional ServiceNow-style Incident Report PDF.
 */
export function generateIncidentPdf({ incident, timeline, notes = [] }: GeneratePdfOptions): any {
  const DocConstructor: any = jsPDF || (jspdfModule as any).jsPDF || (jspdfModule as any).default || jspdfModule;
  const doc: JsPDFType = new DocConstructor({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin - 20) {
      doc.addPage();
      y = margin + 20;
      drawRunningHeader();
    }
  };

  const drawRunningHeader = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 145, 155);
    doc.text(`SkyOps Incident Report • ${incident.id} • ${incident.title.slice(0, 50)}`, margin, margin);
    doc.setDrawColor(220, 225, 235);
    doc.line(margin, margin + 5, pageWidth - margin, margin + 5);
  };

  const drawSectionHeading = (title: string) => {
    checkPageBreak(32);
    y += 10;
    doc.setFillColor(243, 246, 250);
    doc.roundedRect(margin, y, contentWidth, 20, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    doc.text(title.toUpperCase(), margin + 8, y + 13);
    y += 26;
  };

  const drawKeyValueGrid = (items: Array<[string, string]>, cols = 2) => {
    const colWidth = contentWidth / cols;
    const rowHeight = 24;
    for (let i = 0; i < items.length; i += cols) {
      checkPageBreak(rowHeight + 4);
      for (let c = 0; c < cols; c++) {
        const item = items[i + c];
        if (!item) continue;
        const xPos = margin + c * colWidth;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(item[0].toUpperCase(), xPos + 4, y + 8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);
        const val = item[1] || 'Not available';
        const truncated = doc.splitTextToSize(val, colWidth - 12);
        doc.text(truncated[0] || 'Not available', xPos + 4, y + 19);
      }
      y += rowHeight;
    }
    y += 4;
  };

  const tech = incident.technicalDetails || {};
  const priority = getPriorityLabel(incident.severity);

  // --- 1. COVER / HEADER ---
  // Top Banner
  doc.setFillColor(15, 23, 42); // Dark Slate 900
  doc.rect(margin, y, contentWidth, 54, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('SKYOPS INCIDENT REPORT', margin + 12, y + 24);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(`Official SRE Post-Incident & Audit Documentation • Ref: ${incident.id}`, margin + 12, y + 40);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(56, 189, 248); // Sky 400
  doc.text(incident.id, pageWidth - margin - 80, y + 24, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, pageWidth - margin - 12, y + 40, { align: 'right' });

  y += 64;

  // --- 2. EXECUTIVE SUMMARY CARD ---
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 76, 4, 4, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(incident.title, contentWidth - 24);
  doc.text(titleLines[0] || incident.title, margin + 12, y + 18);

  // Badges Strip inside Executive Summary
  const badgeY = y + 32;
  // Severity Badge
  doc.setFillColor(incident.severity === 'CRITICAL' ? 225 : incident.severity === 'HIGH' ? 249 : 241, incident.severity === 'CRITICAL' ? 29 : incident.severity === 'HIGH' ? 115 : 245, incident.severity === 'CRITICAL' ? 72 : 22);
  doc.roundedRect(margin + 12, badgeY, 70, 14, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`SEV: ${incident.severity}`, margin + 47, badgeY + 10, { align: 'center' });

  // Priority Badge
  doc.setFillColor(71, 85, 105);
  doc.roundedRect(margin + 88, badgeY, 80, 14, 2, 2, 'F');
  doc.text(priority, margin + 128, badgeY + 10, { align: 'center' });

  // Status Badge
  doc.setFillColor(incident.status === 'OPEN' ? 220 : incident.status === 'RESOLVED' ? 16 : 100, incident.status === 'OPEN' ? 38 : incident.status === 'RESOLVED' ? 185 : 116, incident.status === 'OPEN' ? 38 : incident.status === 'RESOLVED' ? 129 : 139);
  doc.roundedRect(margin + 174, badgeY, 75, 14, 2, 2, 'F');
  doc.text(`STATUS: ${incident.status}`, margin + 211, badgeY + 10, { align: 'center' });

  // Occurrence Badge
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(margin + 255, badgeY, 85, 14, 2, 2, 'F');
  doc.setTextColor(51, 65, 85);
  doc.text(`OCCURRENCE: ${incident.occurrenceCount}x`, margin + 297, badgeY + 10, { align: 'center' });

  // Short statement
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const summaryText = `Target: ${incident.resourceKind}/${incident.resourceName} in namespace '${incident.namespace}' on cluster '${incident.clusterName}'. Deterministic fingerprint: ${incident.fingerprint.slice(0, 32)}...`;
  doc.text(summaryText, margin + 12, y + 64);

  y += 86;

  // --- 3. EXECUTIVE INCIDENT BREAKDOWN ---
  drawSectionHeading('1. Executive Incident Summary');
  const whatHappened = tech.message || `Kubernetes failure state ${incident.incidentType} observed on ${incident.resourceKind} ${incident.resourceName}.`;
  const whyDetected = tech.reason ? `Kubelet telemetry detected status/condition reason: '${tech.reason}'.` : `Deterministic rule engine matched failure pattern for ${incident.incidentType}.`;
  const currentImpact = tech.impact || (incident.severity === 'CRITICAL' || incident.severity === 'HIGH' ? 'Workload is unavailable or degraded, failing traffic/readiness checks.' : 'Localized component degradation without total cluster outage.');
  const evidenceSummary = tech.rootCause || 'Root cause under investigation via container status and Kubernetes events.';

  const summaryItems: Array<[string, string]> = [
    ['What Happened', whatHappened],
    ['Where It Happened', `Cluster: ${incident.clusterName} (${incident.clusterId}) | NS: ${incident.namespace} | ${incident.resourceKind}/${incident.resourceName}`],
    ['Why SkyOps Detected It', whyDetected],
    ['Current Impact & State', `Status: ${incident.status} | Impact: ${currentImpact}`],
    ['Investigation Findings', evidenceSummary],
    ['Recommended Action', tech.recommendation || 'Inspect pod logs, dependent service endpoints, and manifest definitions.']
  ];

  for (const item of summaryItems) {
    checkPageBreak(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(`${item[0]}:`, margin + 6, y + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(item[1] || 'Not available', contentWidth - 140);
    doc.text(lines, margin + 130, y + 8);
    y += Math.max(14, lines.length * 10) + 4;
  }

  // --- 4. INCIDENT IDENTIFICATION & LIFECYCLE METADATA ---
  drawSectionHeading('2. Incident Classification & Lifecycle Timestamps');
  drawKeyValueGrid([
    ['Incident Ticket ID', incident.id],
    ['Incident Type', incident.incidentType],
    ['Severity Level', incident.severity],
    ['ITIL / SRE Priority', priority],
    ['Current Status', incident.status],
    ['Occurrence Count', `${incident.occurrenceCount} (Initial + Recurrences)`],
    ['First Observed At', formatReportDate(incident.firstSeenAt)],
    ['Last Telemetry Pulse', formatReportDate(incident.lastSeenAt)],
    ['Resolution Timestamp', formatReportDate(incident.resolvedAt)],
    ['Incident Duration / MTTR', formatDuration(incident.firstSeenAt, incident.resolvedAt)],
    ['Assigned Engineer', incident.assignee?.name ? `${incident.assignee.name} (${incident.assignee.email})` : 'Unassigned'],
    ['Organization ID', incident.orgId || 'Not available']
  ], 2);

  // --- 5. KUBERNETES TARGET INFRASTRUCTURE ---
  drawSectionHeading('3. Kubernetes Infrastructure Target');
  drawKeyValueGrid([
    ['Cluster Name', incident.clusterName || 'Not available'],
    ['Cluster ID', incident.clusterId || 'Not available'],
    ['Target Namespace', incident.namespace || 'Not available'],
    ['Resource Kind & Name', `${incident.resourceKind}/${incident.resourceName}`],
    ['Observed Pod Name', tech.podName || incident.resourceName || 'Not available'],
    ['Target Container', tech.containerName || 'Not available'],
    ['Observed Kubernetes Node', tech.nodeName || 'Not available'],
    ['Container Image Spec', tech.image || 'Not available'],
    ['Kubernetes Resource UID', tech.resourceUid || 'Not available'],
    ['Deterministic Fingerprint', incident.fingerprint || 'Not available']
  ], 2);

  // --- 6. FAILURE TELEMETRY & DIAGNOSTICS ---
  drawSectionHeading('4. Diagnostic Evidence & Failure Telemetry');
  drawKeyValueGrid([
    ['Diagnostic Reason', tech.reason || incident.incidentType || 'Not available'],
    ['Observed Workload State', tech.observedState || incident.status || 'Not available'],
    ['Container Restart Count', tech.restartCount !== undefined ? `${tech.restartCount} restarts` : 'Not available'],
    ['Termination Exit Code', tech.exitCode !== undefined ? String(tech.exitCode) : 'Not available'],
    ['Waiting Reason', tech.reason || 'Not available'],
    ['Diagnostic Message', tech.message || 'Not available']
  ], 2);

  // --- 7. CONTAINER STATES TABLE ---
  if (tech.containers && tech.containers.length > 0) {
    drawSectionHeading('5. Container Statuses & Runtime Diagnostics');
    checkPageBreak(40);
    // Table Header
    doc.setFillColor(238, 242, 246);
    doc.rect(margin, y, contentWidth, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('CONTAINER', margin + 6, y + 11);
    doc.text('IMAGE', margin + 110, y + 11);
    doc.text('READY', margin + 260, y + 11);
    doc.text('STATE / REASON', margin + 310, y + 11);
    doc.text('RESTARTS', margin + 420, y + 11);
    doc.text('EXIT', margin + 475, y + 11);
    y += 18;

    for (const c of tech.containers) {
      checkPageBreak(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);

      const nameTrunc = doc.splitTextToSize(c.name, 95)[0];
      const imgTrunc = doc.splitTextToSize(c.image || 'Not available', 140)[0];
      const stateStr = c.waitingReason || c.terminationReason || c.state || 'running';

      doc.text(nameTrunc, margin + 6, y + 9);
      doc.text(imgTrunc, margin + 110, y + 9);
      doc.setTextColor(c.ready ? 16 : 220, c.ready ? 185 : 38, c.ready ? 129 : 38);
      doc.text(c.ready ? 'TRUE' : 'FALSE', margin + 260, y + 9);
      doc.setTextColor(15, 23, 42);
      doc.text(stateStr, margin + 310, y + 9);
      doc.text(String(c.restartCount ?? 0), margin + 420, y + 9);
      doc.text(c.exitCode !== undefined ? String(c.exitCode) : '-', margin + 475, y + 9);

      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + 13, pageWidth - margin, y + 13);
      y += 15;
    }
    y += 4;
  }

  // --- 8. KUBERNETES CONDITIONS TABLE ---
  if (tech.conditions && tech.conditions.length > 0) {
    drawSectionHeading('6. Kubernetes Resource Conditions');
    checkPageBreak(36);
    doc.setFillColor(238, 242, 246);
    doc.rect(margin, y, contentWidth, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text('CONDITION TYPE', margin + 6, y + 11);
    doc.text('STATUS', margin + 140, y + 11);
    doc.text('REASON / MESSAGE', margin + 200, y + 11);
    doc.text('LAST TRANSITION', margin + 410, y + 11);
    y += 18;

    for (const cond of tech.conditions) {
      checkPageBreak(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);

      doc.text(cond.type, margin + 6, y + 9);
      doc.setTextColor(cond.status === 'True' ? 16 : 220, cond.status === 'True' ? 185 : 38, cond.status === 'True' ? 129 : 38);
      doc.text(cond.status, margin + 140, y + 9);
      doc.setTextColor(15, 23, 42);

      const msg = cond.message ? `${cond.reason || ''}: ${cond.message}` : cond.reason || 'Normal';
      const msgTrunc = doc.splitTextToSize(msg, 200)[0];
      doc.text(msgTrunc, margin + 200, y + 9);

      const timeStr = cond.lastTransitionTime ? cond.lastTransitionTime.slice(0, 19).replace('T', ' ') : 'Not available';
      doc.text(timeStr, margin + 410, y + 9);

      doc.setDrawColor(241, 245, 249);
      doc.line(margin, y + 13, pageWidth - margin, y + 13);
      y += 15;
    }
    y += 4;
  }

  // --- 9. KUBERNETES EVENTS LOG ---
  if (tech.events && tech.events.length > 0) {
    drawSectionHeading('7. Observed Kubernetes Events');
    for (const evt of tech.events.slice(-8)) {
      checkPageBreak(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(evt.type === 'Warning' ? 220 : 71, evt.type === 'Warning' ? 38 : 85, evt.type === 'Warning' ? 38 : 105);
      doc.text(`[${evt.type?.toUpperCase() || 'NORMAL'}] ${evt.reason || 'Event'} (Count: ${evt.count || 1}):`, margin + 6, y + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 41, 59);
      const lines = doc.splitTextToSize(evt.message || 'No details provided.', contentWidth - 140);
      doc.text(lines, margin + 135, y + 8);
      y += Math.max(12, lines.length * 9) + 3;
    }
    y += 4;
  }

  // --- 10. INCIDENT LIFECYCLE TIMELINE ---
  drawSectionHeading('8. Chronological Incident Audit Trail');
  for (const evt of timeline) {
    checkPageBreak(20);
    const dateStr = formatReportDate(evt.timestamp);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(dateStr, margin + 6, y + 8);

    doc.setFillColor(evt.type === 'DETECTION' ? 220 : evt.type === 'RECOVERY' ? 16 : evt.type === 'OCCURRENCE' ? 217 : 56, evt.type === 'DETECTION' ? 38 : evt.type === 'RECOVERY' ? 185 : evt.type === 'OCCURRENCE' ? 119 : 189, evt.type === 'DETECTION' ? 38 : evt.type === 'RECOVERY' ? 129 : evt.type === 'OCCURRENCE' ? 6 : 248);
    doc.roundedRect(margin + 125, y + 1, 68, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6.5);
    doc.text(evt.type, margin + 159, y + 8, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(15, 23, 42);
    const descLines = doc.splitTextToSize(`${evt.description} (by ${evt.actor.name || 'System'})`, contentWidth - 205);
    doc.text(descLines, margin + 200, y + 8);

    y += Math.max(12, descLines.length * 9) + 4;
  }

  // --- 11. INVESTIGATION NOTES ---
  if (notes.length > 0) {
    drawSectionHeading('9. Engineering Notes & Investigation Findings');
    for (const note of notes) {
      checkPageBreak(28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`${note.authorName} (${formatReportDate(note.createdAt)}):`, margin + 6, y + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      const noteLines = doc.splitTextToSize(note.content, contentWidth - 12);
      doc.text(noteLines, margin + 6, y + 18);
      y += 18 + noteLines.length * 9;
    }
  }

  // --- FOOTER & PAGE NUMBERING ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - margin + 10, pageWidth - margin, pageHeight - margin + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('SkyOps SRE Incident Management • Autonomous Observability Engine', margin, pageHeight - margin + 22);
    doc.text('CONFIDENTIAL & PROPRIETARY', pageWidth / 2, pageHeight - margin + 22, { align: 'center' });
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - margin + 22, { align: 'right' });
  }

  // Save the PDF if running in browser environment, otherwise return doc
  const filename = `SkyOps_Incident_${incident.id}_${incident.incidentType}_${new Date().toISOString().slice(0, 10)}.pdf`;
  if (typeof window !== 'undefined' && typeof doc.save === 'function') {
    doc.save(filename);
  }
  return doc;
}
