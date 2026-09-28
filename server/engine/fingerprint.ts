import crypto from 'crypto';

/**
 * Deterministically computes an incident fingerprint hash.
 * Formula: SHA256(clusterId:namespace:resourceKind:resourceName:incidentType:container:rootCauseCategory)
 */
export function generateIncidentFingerprint(
  clusterId: string,
  namespace: string,
  resourceKind: string,
  resourceName: string,
  incidentType: string,
  containerName = '',
  rootCauseCategory = ''
): string {
  const normalizedKey = [
    clusterId.trim(),
    namespace.trim().toLowerCase(),
    resourceKind.trim().toLowerCase(),
    resourceName.trim().toLowerCase(),
    incidentType.trim(),
    containerName.trim().toLowerCase(),
    rootCauseCategory.trim()
  ].join(':');

  return crypto.createHash('sha256').update(normalizedKey).digest('hex');
}
