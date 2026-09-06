import { Incident, KubernetesResource, SkyOpsAIAnalysis } from '../../src/types/index';
import { SkyOpsIntelligenceEngine } from '../engine/intelligence';
import { buildIncidentContext } from './contextBuilder';
import { GeminiAIProvider } from './providers/geminiProvider';
import { SafetyPolicyEngine } from './safetyPolicy';
import { AIProvider } from './types';

export class SkyOpsAIService {
  private provider: AIProvider;
  private cache: Map<string, { analysis: SkyOpsAIAnalysis; timestamp: number; incidentUpdatedAt: number }> = new Map();
  private inFlightRequests: Map<string, Promise<SkyOpsAIAnalysis>> = new Map();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

  constructor(provider?: AIProvider) {
    this.provider = provider || new GeminiAIProvider();
  }

  public setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  public getProvider(): AIProvider {
    return this.provider;
  }

  public getInFlightCount(): number {
    return this.inFlightRequests.size;
  }

  public getCachedAnalysis(incidentId: string): SkyOpsAIAnalysis | null {
    const entry = this.cache.get(incidentId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(incidentId);
      return null;
    }
    return entry.analysis;
  }

  public async analyzeIncident(
    incident: Incident,
    associatedResource?: KubernetesResource | null,
    options?: {
      force?: boolean;
      notes?: string[];
      allResources?: KubernetesResource[];
      metrics?: any;
    }
  ): Promise<SkyOpsAIAnalysis> {
    const cacheKey = incident.id;
    const isForce = Boolean(options?.force);
    const inFlightKey = isForce
      ? `${incident.id}:${incident.updatedAt}:force`
      : `${incident.id}:${incident.updatedAt}`;

    // 1. Check if valid cached analysis exists for this incident version unless force refresh is requested
    if (isForce) {
      this.cache.delete(cacheKey);
    } else {
      const cached = this.cache.get(cacheKey);
      if (
        cached &&
        cached.incidentUpdatedAt === incident.updatedAt &&
        Date.now() - cached.timestamp < this.CACHE_TTL_MS
      ) {
        return {
          ...cached.analysis,
          status: 'CACHED'
        };
      }
    }

    // 2. In-flight request deduplication: if identical analysis is already running, share the promise
    const existingInFlight = this.inFlightRequests.get(inFlightKey);
    if (existingInFlight) {
      console.log(
        `[SkyOps AI] Sharing existing in-flight AI request for incident ${incident.id} (updatedAt: ${incident.updatedAt})`
      );
      return existingInFlight;
    }

    // 3. Run authoritative deterministic intelligence analysis
    const deterministicIntelligence = SkyOpsIntelligenceEngine.analyzeIncident(
      incident,
      associatedResource,
      options?.allResources || [],
      options?.metrics
    );

    // 4. Create execution promise
    const executionPromise = (async (): Promise<SkyOpsAIAnalysis> => {
      const requestReceivedAt = Date.now();
      console.log(
        `[SkyOps AI] [Request Received] Starting root cause analysis for incident ${incident.id} (${incident.incidentType}) on cluster ${incident.clusterId} using provider ${this.provider.name}...`
      );

      // Build sanitized, token-efficient incident context with deterministic intelligence injected
      const context = buildIncidentContext(
        incident,
        associatedResource,
        options?.notes,
        deterministicIntelligence
      );
      const contextConstructedAt = Date.now();
      const contextConstructionMs = Math.max(0, contextConstructedAt - requestReceivedAt);

      // Delegate to AI Provider
      let analysis: SkyOpsAIAnalysis;
      try {
        analysis = await this.provider.analyzeIncident(context);

        // Grounding guarantee: deterministic intelligence remains authoritative for confirmed facts
        if (
          deterministicIntelligence.primaryHypothesis?.status === 'CONFIRMED' &&
          !deterministicIntelligence.isUnknownOrInconclusive
        ) {
          // Keep confidence high and grounded in observed facts
          if (analysis.confidence < deterministicIntelligence.confidence) {
            analysis.confidence = Math.max(analysis.confidence, deterministicIntelligence.confidence);
          }
        }
        analysis.intelligence = deterministicIntelligence;
      } catch (err: any) {
        console.error(`[SkyOps AI] Unexpected error during AI analysis for ${incident.id}:`, err?.message || err);
        const fallbackAnalysis: Partial<SkyOpsAIAnalysis> = {
          incidentId: incident.id,
          summary: `Incident ${incident.id} detected on ${incident.resourceKind} ${incident.resourceName}: ${deterministicIntelligence.rootCause}.`,
          rootCause: deterministicIntelligence.rootCause,
          confidence: deterministicIntelligence.confidence,
          confidenceExplanation: deterministicIntelligence.confidenceExplanation,
          intelligence: deterministicIntelligence,
          evidence: deterministicIntelligence.signals.map((s) => ({
            category: s.category === 'FACT' ? 'OBSERVED_FACT' : 'AI_INFERENCE',
            source: `${s.resourceKind} ${s.property}`,
            detail: s.description
          })),
          affectedResources: [
            { kind: incident.resourceKind, namespace: incident.namespace, name: incident.resourceName }
          ],
          recommendedFix: {
            description: deterministicIntelligence.recommendation,
            reason: deterministicIntelligence.explainability.whySelected,
            risk: 'LOW',
            expectedImpact: 'Deterministic remediation evaluation.',
            rollback: 'None required.'
          },
          saferAlternative: {
            description: `Run 'kubectl describe ${incident.resourceKind.toLowerCase()} ${incident.resourceName} -n ${incident.namespace}'`,
            reason: 'Provides authoritative live cluster status directly from the Kubernetes API server.'
          },
          requiresApproval: true,
          additionalEvidenceNeeded: deterministicIntelligence.explainability.missingEvidence || [],
          analyzedAt: Date.now(),
          provider: this.provider.name,
          model: this.provider.model,
          status: 'FAILED',
          errorMessage: err?.message || 'AI service error',
          executionSafe: true
        };
        analysis = SafetyPolicyEngine.validateAndEnforce(fallbackAnalysis, incident.id, context);
        analysis.intelligence = deterministicIntelligence;
      }

      const responseReturnedAt = Date.now();
      const totalDurationMs = Math.max(0, responseReturnedAt - requestReceivedAt);

      // Finalize timing breakdown
      const timing = {
        requestReceivedAt,
        contextConstructedAt,
        geminiRequestStartedAt: analysis.timing?.geminiRequestStartedAt || contextConstructedAt,
        geminiResponseReceivedAt: analysis.timing?.geminiResponseReceivedAt || responseReturnedAt,
        structuredParsedAt: analysis.timing?.structuredParsedAt || responseReturnedAt,
        safetyValidatedAt: analysis.timing?.safetyValidatedAt || responseReturnedAt,
        responseReturnedAt,
        durations: {
          contextConstructionMs,
          geminiCallMs: analysis.timing?.durations?.geminiCallMs ?? 0,
          parsingMs: analysis.timing?.durations?.parsingMs ?? 0,
          safetyValidationMs: analysis.timing?.durations?.safetyValidationMs ?? 0,
          totalMs: totalDurationMs
        }
      };

      analysis.timing = timing;

      console.log(
        `[SkyOps AI Latency Breakdown] Incident: ${incident.id} | Total: ${timing.durations.totalMs}ms | Context Construction: ${timing.durations.contextConstructionMs}ms | Gemini Request: ${timing.durations.geminiCallMs}ms | Structured Parsing: ${timing.durations.parsingMs}ms | Safety Validation: ${timing.durations.safetyValidationMs}ms | Status: ${analysis.status} | Confidence: ${Math.round(analysis.confidence * 100)}%`
      );

      // Cache successful analysis; do not cache failed/unavailable results long-term (only 15s to debounce rapid clicks)
      const isFailedOrUnavailable = analysis.status === 'FAILED' || analysis.status === 'UNAVAILABLE';
      if (!isFailedOrUnavailable) {
        this.cache.set(cacheKey, {
          analysis,
          timestamp: Date.now(),
          incidentUpdatedAt: incident.updatedAt
        });
      } else {
        // Short debounce cache for 15 seconds
        this.cache.set(cacheKey, {
          analysis,
          timestamp: Date.now() - (this.CACHE_TTL_MS - 15000),
          incidentUpdatedAt: incident.updatedAt
        });
      }

      return analysis;
    })();

    this.inFlightRequests.set(inFlightKey, executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightRequests.delete(inFlightKey);
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

export const skyOpsAIService = new SkyOpsAIService();
