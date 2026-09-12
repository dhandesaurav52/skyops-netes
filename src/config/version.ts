/**
 * Authoritative single source of truth for the SkyOps Kubernetes Agent release version.
 * Synchronized across Go agent binary, GHCR Docker tags, Helm Chart, and Web UI.
 */
export const AGENT_VERSION = 'v1.5.0';
export const AGENT_IMAGE_REPOSITORY = 'ghcr.io/skyops-software-solutions/skyops-agent';
export const AGENT_DEFAULT_NAMESPACE = 'skyops-system';
