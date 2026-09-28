import { PodLogLine, PodLogsResponse } from '../src/types/index';
import * as fs from 'fs';
import * as https from 'https';

/**
 * Enterprise Redaction Engine for Kubernetes Logs
 * Ensures credentials, tokens, passwords, keys, and private data are never exposed.
 */
export function redactSensitiveLogData(text: string): string {
  if (!text) return text;

  let redacted = text;

  // 1. Redact Private Key blocks
  redacted = redacted.replace(
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // 2. Redact Authorization headers (Bearer tokens, Basic Auth)
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED_BEARER_TOKEN]');
  redacted = redacted.replace(/Basic\s+[A-Za-z0-9+/=]{12,}/gi, 'Basic [REDACTED_BASIC_AUTH]');

  // 3. Redact JWT tokens
  redacted = redacted.replace(
    /eyJ[A-Za-z0-9-_]{10,}\.eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]+/g,
    '[REDACTED_JWT_TOKEN]'
  );

  // 4. Redact SkyOps agent tokens & install keys
  redacted = redacted.replace(/skyops_agent_[a-zA-Z0-9_-]+/g, '[REDACTED_AGENT_TOKEN]');
  redacted = redacted.replace(/skyops_inst_[a-zA-Z0-9_-]+/g, '[REDACTED_INSTALL_KEY]');

  // 5. Redact Key-value credential patterns (e.g. password=..., secret=..., token=..., apiKey=...)
  redacted = redacted.replace(
    /(['"]?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)['"]?\s*[:=]\s*['"]?)(?!\s*\[REDACTED)([^'"\s,;]+)(['"]?)/gi,
    '$1[REDACTED]$3'
  );

  // 6. Redact Database / SMTP connection strings containing credentials
  redacted = redacted.replace(
    /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|smtp|amqp):\/\/([^:\s]+):([^@\s]+)@/gi,
    '$1://$2:[REDACTED]@'
  );

  // 7. Redact AWS / Cloud API keys
  redacted = redacted.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]');

  return redacted;
}

/**
 * Regex matching standard Kubernetes log timestamp prefix:
 * e.g. 2026-09-12T14:22:30.123456789Z or 2026-09-12T14:22:30Z
 */
const K8S_TIMESTAMP_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+(.*)$/;

/**
 * Parses raw log text into structured, redacted log lines.
 */
export function parseLogLines(rawText: string, searchFilter?: string): PodLogLine[] {
  if (!rawText) return [];

  const lines = rawText.split('\n');
  const result: PodLogLine[] = [];
  const filterLower = searchFilter ? searchFilter.trim().toLowerCase() : null;

  for (let line of lines) {
    line = line.replace(/\r$/, '');
    if (!line && lines.length > 1) {
      continue;
    }

    const redacted = redactSensitiveLogData(line);
    const match = redacted.match(K8S_TIMESTAMP_REGEX);

    let parsedLine: PodLogLine;
    if (match) {
      parsedLine = {
        timestamp: match[1],
        message: match[2],
        raw: redacted
      };
    } else {
      parsedLine = {
        message: redacted,
        raw: redacted
      };
    }

    if (filterLower) {
      if (!parsedLine.message.toLowerCase().includes(filterLower) && !parsedLine.raw.toLowerCase().includes(filterLower)) {
        continue;
      }
    }

    result.push(parsedLine);
  }

  return result;
}

/**
 * Attempts to retrieve in-cluster logs directly if running inside Kubernetes.
 */
export async function fetchInClusterPodLogs(
  namespace: string,
  podName: string,
  container: string,
  options: {
    tailLines?: number;
    previous?: boolean;
    sinceSeconds?: number;
    timestamps?: boolean;
  }
): Promise<string | null> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  if (!host) {
    return null;
  }

  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    const ca = fs.existsSync(caPath) ? fs.readFileSync(caPath) : undefined;

    const queryParams = new URLSearchParams();
    if (container) queryParams.set('container', container);
    if (options.tailLines) queryParams.set('tailLines', Math.min(1000, options.tailLines).toString());
    if (options.previous) queryParams.set('previous', 'true');
    if (options.sinceSeconds) queryParams.set('sinceSeconds', options.sinceSeconds.toString());
    if (options.timestamps !== false) queryParams.set('timestamps', 'true');

    const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${queryParams.toString()}`;

    return await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          host,
          port,
          path,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          },
          ca,
          rejectUnauthorized: !!ca,
          timeout: 5000
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`Kubernetes API responded with status ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Kubernetes API log request timed out'));
      });
      req.end();
    });
  } catch (err: any) {
    console.warn(`[LogRetriever] In-cluster direct log fetch failed for ${namespace}/${podName}:`, err?.message || err);
    return null;
  }
}
