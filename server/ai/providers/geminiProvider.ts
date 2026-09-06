import { GoogleGenAI, Type } from '@google/genai';
import { SafetyPolicyEngine } from '../safetyPolicy';
import { AIProvider, IncidentContext, SkyOpsAIAnalysis } from '../types';

const PRIMARY_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const CANDIDATE_MODELS = [PRIMARY_GEMINI_MODEL, 'gemini-3.8-flash'];
const REQUEST_TIMEOUT_MS = 15000;
const GLOBAL_TIMEOUT_MS = 25000;

export class GeminiAIProvider implements AIProvider {
  public readonly name = 'SkyOps AI';
  public readonly model = 'skyops-ai-engine';
  private client: GoogleGenAI | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.trim().length > 0) {
      try {
        this.client = new GoogleGenAI({
          apiKey: apiKey.trim(),
          httpOptions: {
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
              'User-Agent': 'aistudio-build'
            }
          }
        });
      } catch (err) {
        console.error('[SkyOps AI Gemini] Failed to initialize GoogleGenAI client:', err);
        this.client = null;
      }
    }
  }

  public isAvailable(): boolean {
    const apiKey = process.env.GEMINI_API_KEY;
    return Boolean(apiKey && apiKey.trim().length > 0);
  }

  private isRetryableError(err: any): boolean {
    if (!err) return false;
    const msg = String(err.message || err).toLowerCase();
    const status = err.status || err.statusCode || err.code;
    return (
      status === 503 ||
      status === 504 ||
      status === 429 ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('deadline exceeded') ||
      msg.includes('resource exhausted') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout')
    );
  }

  private isServiceUnavailable(err: any): boolean {
    if (!err) return false;
    const msg = String(err.message || err).toLowerCase();
    const status = err.status || err.statusCode || err.code;
    return (
      status === 503 ||
      status === 504 ||
      status === 429 ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('unavailable') ||
      msg.includes('high demand') ||
      msg.includes('overloaded') ||
      msg.includes('deadline exceeded') ||
      msg.includes('resource exhausted')
    );
  }

  public async analyzeIncident(context: IncidentContext): Promise<SkyOpsAIAnalysis> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return this.generateGracefulFallback(
        context,
        'SkyOps AI reasoning engine credentials are not configured in the server environment (GEMINI_API_KEY). Operating in manual inspection fallback mode.',
        'UNAVAILABLE'
      );
    }

    if (!this.client) {
      this.initClient();
    }

    if (!this.client) {
      return this.generateGracefulFallback(
        context,
        'SkyOps AI client failed initialization. Operating in manual inspection mode.',
        'FAILED'
      );
    }

    const systemInstruction = `You are SkyOps AI, an evidence-driven Kubernetes incident reasoning engine.
Your architecture operates as:
Kubernetes → SkyOps Agent → Telemetry/Evidence → SkyOps Backend → SkyOps AI → Human Decision → Optional Remediation → Agent → Kubernetes → Verification

You reason over authoritative Kubernetes information to prove why an incident is happening, show exact change previews, and specify how to verify resolution.

Core Principles:
1. EVIDENCE GROUNDING: Correlate pod/container state, images, restart count, exit codes, termination reason, waiting reason, readiness/liveness status, Deployment/ReplicaSet/StatefulSet ownership, replica counts, conditions, PVC/PV state, events, error messages, and spec/status summaries.
2. CATEGORIZATION: Explicitly distinguish between:
   - OBSERVED_FACT (raw cluster facts, exit codes, event logs, container statuses)
   - AI_INFERENCE (diagnostic deductions and root cause reasoning)
   - PROPOSED_CHANGE (remediation actions)
3. 10-POINT INCIDENT INTELLIGENCE:
   - 1. What happened? (Observable failure summary)
   - 2. Root cause (Specific technical cause proved by evidence)
   - 3. Confidence (0.0 to 1.0) & Explanation (what evidence supports this score)
   - 4. Corroborating evidence (categorized list of supporting facts and deductions)
   - 5. Recommended fix (remediation action addressing the root cause)
   - 6. Exact change preview (resource → namespace → object → container → field → current value → proposed value)
   - 7. Expected impact (potential restart/downtime implications, affected workloads)
   - 8. Risk (LOW, MEDIUM, HIGH, CRITICAL) & explanation
   - 9. Rollback (exact reversal procedure, e.g. 'kubectl rollout undo deployment/xyz -n prod')
   - 10. Verification (Kubernetes conditions SkyOps should observe to prove the fix worked)
4. INSUFFICIENT EVIDENCE RULE: If telemetry/evidence is insufficient, explicitly state that you cannot determine the root cause with certainty, lower the confidence score, list what is missing in 'additionalEvidenceNeeded', and do NOT fabricate images, resources, or commands.
5. INCIDENT CLASS SPECIFICITY:
   - ImagePullBackOff / ErrImagePull: Correlate invalid image reference → ErrImagePull event → ImagePullBackOff state. Generate exact image replacement change preview if a clean valid tag is identifiable.
   - CrashLoopBackOff: Investigate exit codes (e.g. 137 OOMKilled, 1 application error, 127 command not found), termination messages, restart counts, and environment/config. DO NOT blindly recommend an image change!
   - PVC / Storage issues: Investigate PVC conditions, StorageClass, PV binding, and volume mount specs.
6. AUTHORITATIVE DETERMINISTIC INTELLIGENCE: The SkyOps Deterministic Intelligence Engine provides authoritative observed facts, derived telemetry, correlated signals, and scored hypotheses. Gemini must respect and be strictly grounded in these confirmed facts, and MUST NOT contradict or override confirmed cluster facts. Use your generative reasoning to synthesize, explain, and guide human operators.
7. SAFETY & NO DIRECT EXECUTION: Never output raw automatic shell scripts. All remediations are structured proposals for human operator approval before execution by the SkyOps Agent.`;

    const intelligenceText = context.intelligence
      ? `
DETERMINISTIC INTELLIGENCE ENGINE FINDINGS:
- Authoritative Root Cause: ${context.intelligence.rootCause} (Category: ${context.intelligence.rootCauseCategory})
- Engine Confidence: ${Math.round(context.intelligence.confidence * 100)}% (${context.intelligence.confidenceLevel})
- Selection Rationale: ${context.intelligence.explainability.whySelected}
- Primary Scored Hypothesis: ${context.intelligence.primaryHypothesis?.title || 'None'} [Status: ${context.intelligence.primaryHypothesis?.status || 'N/A'}, Score: ${context.intelligence.primaryHypothesis?.score ?? 'N/A'}]
- Evaluated Alternative Hypotheses: ${context.intelligence.evaluatedHypotheses.map((h) => `${h.title} (Status: ${h.status}, Score: ${h.score})`).join('; ')}
- Correlated Signals (Fact vs Inference):
${context.intelligence.signals.map((s) => `  * [${s.category}] ${s.resourceKind}/${s.resourceName} -> ${s.property}: ${JSON.stringify(s.value)} (${s.description})`).slice(0, 15).join('\n')}
- Correlated Timeline:
${context.intelligence.correlatedTimeline.map((t) => `  * [${new Date(t.timestamp).toISOString()}] [${t.category}] ${t.title}: ${t.description}`).slice(0, 10).join('\n')}
- Recommended Action: ${context.intelligence.recommendation}
${context.intelligence.executableProposal ? `- Proposed Executable Action: ${context.intelligence.executableProposal.actionType} on ${context.intelligence.executableProposal.targetResource.kind}/${context.intelligence.executableProposal.targetResource.name} (field: ${context.intelligence.executableProposal.fieldPath})` : ''}
`
      : '';

    const userPrompt = `Perform deep evidence-driven reasoning for the following Kubernetes incident:

${intelligenceText}

INCIDENT METADATA:
- Incident ID: ${context.incidentId}
- Incident Type: ${context.incidentType}
- Severity: ${context.severity}
- Cluster ID: ${context.clusterId} (${context.clusterName})
- Target Resource: ${context.resourceKind}/${context.resourceName} (Namespace: "${context.namespace}")
- Owner References: ${context.ownerReferences ? JSON.stringify(context.ownerReferences) : 'None'}
- Replica Counts: ${context.replicaCounts ? JSON.stringify(context.replicaCounts) : 'N/A'}
- Occurrence Count: ${context.occurrenceCount}
- First Seen: ${context.firstSeenAt}
- Last Seen: ${context.lastSeenAt}

TECHNICAL DIAGNOSTICS:
- Target Pod: ${context.targetPod || 'N/A'}
- Target Container: ${context.targetContainer || 'N/A'}
- Target Image: ${context.targetImage || 'N/A'} (Tag: ${context.imageTag || 'N/A'})
- Restart Count: ${context.restartCount ?? 'N/A'}
- Exit Code: ${context.exitCode ?? 'N/A'}
- Termination Reason: ${context.terminationReason || 'N/A'}
- Waiting Reason: ${context.waitingReason || 'N/A'}
- Node: ${context.nodeName || 'N/A'}
- Observed State: ${context.observedState || 'N/A'}
- Kubernetes Status: ${context.k8sStatus || 'N/A'}
- PVC Diagnostics: ${context.pvcDiagnostics ? JSON.stringify(context.pvcDiagnostics) : 'N/A'}

CONTAINER STATES:
${JSON.stringify(context.containers, null, 2)}

RECENT KUBERNETES EVENTS:
${JSON.stringify(context.recentEvents, null, 2)}

CONDITIONS:
${JSON.stringify(context.conditions, null, 2)}

RELATED RESOURCES:
${JSON.stringify(context.relatedResources, null, 2)}

SPEC SUMMARY:
${JSON.stringify(context.specSummary, null, 2)}

STATUS SUMMARY:
${JSON.stringify(context.statusSummary, null, 2)}
`;

    const requestSchema = {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: '1. What happened? A concise 1-2 sentence executive summary of the observable failure.'
        },
        rootCause: {
          type: Type.STRING,
          description: '2. Root cause: Precise technical explanation of the most likely root cause proved by evidence.'
        },
        confidence: {
          type: Type.NUMBER,
          description: '3. Confidence score from 0.0 to 1.0 (e.g. 0.95 for 95% certainty).'
        },
        confidenceExplanation: {
          type: Type.STRING,
          description: '3. Explanation of why the evidence supports this confidence score.'
        },
        evidence: {
          type: Type.ARRAY,
          description: '4. Corroborating evidence items categorized as OBSERVED_FACT, AI_INFERENCE, or PROPOSED_CHANGE.',
          items: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                description: 'OBSERVED_FACT, AI_INFERENCE, or PROPOSED_CHANGE'
              },
              source: { type: Type.STRING, description: 'Source (e.g. Event, ContainerStatus, Spec, PVC, PodLogs)' },
              detail: { type: Type.STRING, description: 'Concrete observation, error message, or deduction' }
            },
            required: ['category', 'source', 'detail']
          }
        },
        affectedResources: {
          type: Type.ARRAY,
          description: 'Kubernetes resources impacted by this incident.',
          items: {
            type: Type.OBJECT,
            properties: {
              kind: { type: Type.STRING },
              namespace: { type: Type.STRING },
              name: { type: Type.STRING }
            },
            required: ['kind', 'namespace', 'name']
          }
        },
        recommendedFix: {
          type: Type.OBJECT,
          description: '5. Recommended fix addressing the root cause safely.',
          properties: {
            description: { type: Type.STRING, description: 'Clear explanation of the proposed fix' },
            reason: { type: Type.STRING, description: 'Why this fix resolves the root cause' },
            risk: { type: Type.STRING, description: 'LOW, MEDIUM, HIGH, or CRITICAL' },
            expectedImpact: { type: Type.STRING, description: 'Expected operational impact on workloads' },
            rollback: { type: Type.STRING, description: 'Step to safely roll back if issues arise' }
          },
          required: ['description', 'reason', 'risk', 'expectedImpact', 'rollback']
        },
        changePreview: {
          type: Type.OBJECT,
          description: '6. Exact change preview showing resource -> namespace -> object -> container -> field -> currentValue -> proposedValue.',
          properties: {
            resource: { type: Type.STRING, description: 'e.g. Deployment, Pod, StatefulSet' },
            namespace: { type: Type.STRING, description: 'Kubernetes namespace' },
            object: { type: Type.STRING, description: 'Resource name' },
            container: { type: Type.STRING, description: 'Container name if applicable' },
            field: { type: Type.STRING, description: 'e.g. spec.template.spec.containers[0].image' },
            currentValue: { type: Type.STRING, description: 'Current failing value' },
            proposedValue: { type: Type.STRING, description: 'Proposed replacement value' }
          },
          required: ['resource', 'namespace', 'object', 'field', 'currentValue', 'proposedValue']
        },
        expectedImpact: {
          type: Type.STRING,
          description: '7. Potential restart/downtime implications and affected workloads.'
        },
        riskExplanation: {
          type: Type.STRING,
          description: '8. Explanation for the assigned risk classification.'
        },
        rollback: {
          type: Type.STRING,
          description: '9. Exact rollback command or procedure.'
        },
        verificationCriteria: {
          type: Type.OBJECT,
          description: '10. Kubernetes conditions SkyOps should observe to determine whether the remediation worked.',
          properties: {
            expectedState: { type: Type.STRING, description: 'e.g. Pod phase Running and all containers Ready=True' },
            conditions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: 'Condition type (e.g. Ready, ContainersReady)' },
                  status: { type: Type.STRING, description: 'Condition status (e.g. True)' },
                  description: { type: Type.STRING, description: 'Explanation' }
                },
                required: ['type', 'status']
              }
            },
            observationWindowSeconds: { type: Type.NUMBER, description: 'Observation window in seconds (e.g. 30)' }
          },
          required: ['expectedState', 'conditions']
        },
        saferAlternative: {
          type: Type.OBJECT,
          description: 'A safer, more declarative or lower-risk alternative approach.',
          properties: {
            description: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ['description', 'reason']
        },
        requiresApproval: {
          type: Type.BOOLEAN,
          description: 'Always true to enforce human oversight before execution.'
        },
        structuredRemediation: {
          type: Type.OBJECT,
          description: 'Structured, typed remediation proposal for human approval and execution.',
          properties: {
            actionType: {
              type: Type.STRING,
              description: 'UPDATE_CONTAINER_IMAGE, REVERT_TAG, ROLLOUT_RESTART, RESOURCE_RESIZING, SCALE_REPLICAS, CONFIG_REVISION, or MANUAL_INSPECTION'
            },
            parameters: {
              type: Type.OBJECT,
              description: 'Typed parameters for the remediation',
              properties: {
                containerName: { type: Type.STRING, description: 'Target container name' },
                currentImage: { type: Type.STRING, description: 'Current failing image name and tag' },
                proposedImage: { type: Type.STRING, description: 'Corrected image name and tag to apply' }
              }
            }
          }
        },
        additionalEvidenceNeeded: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Additional logs, telemetry, or metrics that would increase confidence if evidence was insufficient.'
        }
      },
      required: [
        'summary',
        'rootCause',
        'confidence',
        'evidence',
        'affectedResources',
        'recommendedFix',
        'saferAlternative',
        'requiresApproval'
      ]
    };

    // Execute with bounded retry (max 1 retry for transient 503/504/429) and hard global deadline
    let geminiRequestStartedAt = 0;
    let geminiResponseReceivedAt = 0;
    let structuredParsedAt = 0;
    let safetyValidatedAt = 0;

    try {
      const executeCall = async () => {
        let lastError: any = null;

        for (const modelName of CANDIDATE_MODELS) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              geminiRequestStartedAt = Date.now();
              const res = await this.client!.models.generateContent({
                model: modelName,
                contents: userPrompt,
                config: {
                  systemInstruction,
                  responseMimeType: 'application/json',
                  responseSchema: requestSchema
                }
              });
              geminiResponseReceivedAt = Date.now();
              return res;
            } catch (err: any) {
              lastError = err;
              console.warn(`[SkyOps AI] Model ${modelName} attempt ${attempt} failed:`, err?.message || err);

              const isQuotaExhausted =
                err?.status === 429 ||
                String(err?.message || '').toLowerCase().includes('quota') ||
                String(err?.message || '').toLowerCase().includes('resource_exhausted');

              if (!isQuotaExhausted && attempt < 2 && this.isRetryableError(err)) {
                // Wait 1000ms bounded backoff before the single retry
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
              }
              // Move to next candidate model if available
              break;
            }
          }
        }
        throw lastError || new Error('SkyOps AI request failed across candidate models');
      };

      // Wrap in a hard global timeout cap to guarantee the endpoint returns promptly
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`SkyOps AI analysis deadline exceeded (${GLOBAL_TIMEOUT_MS}ms)`));
        }, GLOBAL_TIMEOUT_MS);
      });

      const response: any = await Promise.race([executeCall(), timeoutPromise]);

      const responseText = response?.text;
      if (!responseText) {
        throw new Error('SkyOps AI engine returned an empty response text.');
      }

      const parsed = JSON.parse(responseText);
      structuredParsedAt = Date.now();

      const enforced = SafetyPolicyEngine.validateAndEnforce(
        {
          ...parsed,
          incidentId: context.incidentId,
          status: 'SUCCESS',
          provider: this.name,
          model: this.model,
          analyzedAt: Date.now()
        },
        context.incidentId,
        context
      );
      safetyValidatedAt = Date.now();

      return {
        ...enforced,
        timing: {
          requestReceivedAt: geminiRequestStartedAt,
          contextConstructedAt: geminiRequestStartedAt,
          geminiRequestStartedAt,
          geminiResponseReceivedAt,
          structuredParsedAt,
          safetyValidatedAt,
          responseReturnedAt: Date.now(),
          durations: {
            contextConstructionMs: 0,
            geminiCallMs: Math.max(0, geminiResponseReceivedAt - geminiRequestStartedAt),
            parsingMs: Math.max(0, structuredParsedAt - geminiResponseReceivedAt),
            safetyValidationMs: Math.max(0, safetyValidatedAt - structuredParsedAt),
            totalMs: Math.max(0, safetyValidatedAt - geminiRequestStartedAt)
          }
        }
      };
    } catch (err: any) {
      const isUnavailable = this.isServiceUnavailable(err);
      console.error(`[SkyOps AI Error] Failed to analyze incident ${context.incidentId}:`, err?.message || err);

      const errorMessage = isUnavailable
        ? 'SkyOps AI reasoning engine is temporarily unavailable due to upstream model capacity or timeout (503 Service Unavailable). Manual inspection recommended.'
        : err?.message || 'SkyOps AI service call failed';

      return this.generateGracefulFallback(
        context,
        errorMessage,
        isUnavailable ? 'UNAVAILABLE' : 'FAILED',
        geminiRequestStartedAt
      );
    }
  }

  private generateGracefulFallback(
    context: IncidentContext,
    errorMessage: string,
    status: 'UNAVAILABLE' | 'FAILED',
    startedAt = Date.now()
  ): SkyOpsAIAnalysis {
    const safetyValidatedAt = Date.now();
    const fallback = SafetyPolicyEngine.validateAndEnforce(
      {
        incidentId: context.incidentId,
        summary: `Automated AI analysis for incident ${context.incidentId} (${context.incidentType}) on ${context.resourceKind}/${context.resourceName} is currently operating in manual inspection mode.`,
        rootCause:
          context.observedState ||
          `Kubernetes observed ${context.incidentType} on ${context.resourceKind}/${context.resourceName}. AI reasoning is temporarily unavailable; inspect raw event telemetry.`,
        confidence: 0.5,
        confidenceExplanation: 'AI reasoning offline; score reflects unverified raw telemetry without model correlation.',
        evidence: [
          {
            category: 'OBSERVED_FACT',
            source: 'SkyOps Detection Engine',
            detail: `Incident Type: ${context.incidentType} on ${context.resourceKind}/${context.resourceName} (Namespace: ${context.namespace})`
          },
          {
            category: 'OBSERVED_FACT',
            source: 'System Status',
            detail: errorMessage
          }
        ],
        affectedResources: [
          { kind: context.resourceKind, namespace: context.namespace, name: context.resourceName }
        ],
        recommendedFix: {
          description: `Inspect pod events and container statuses with 'kubectl describe ${context.resourceKind.toLowerCase()} ${context.resourceName} -n ${context.namespace}'`,
          reason: 'Manual diagnostic review during AI service interruption.',
          risk: 'LOW',
          expectedImpact: 'No cluster modifications executed.',
          rollback: 'None required.'
        },
        expectedImpact: 'No automated changes will be applied to the cluster.',
        riskExplanation: 'Manual inspection carries zero operational risk to cluster workloads.',
        rollback: `kubectl describe ${context.resourceKind.toLowerCase()} ${context.resourceName} -n ${context.namespace}`,
        verificationCriteria: {
          expectedState: 'Manual inspection complete and cluster telemetry reports healthy workload.',
          conditions: [
            { type: 'Ready', status: 'True', description: 'Workload pod ready' }
          ],
          observationWindowSeconds: 30
        },
        saferAlternative: {
          description: `Review pod logs directly with 'kubectl logs ${context.resourceName} -n ${context.namespace}'`,
          reason: 'Provides authoritative event streams and failure codes directly from the Kubernetes cluster.'
        },
        status,
        errorMessage,
        provider: this.name,
        model: this.model,
        analyzedAt: Date.now()
      },
      context.incidentId,
      context
    );

    return {
      ...fallback,
      timing: {
        requestReceivedAt: startedAt,
        contextConstructedAt: startedAt,
        geminiRequestStartedAt: startedAt,
        geminiResponseReceivedAt: Date.now(),
        structuredParsedAt: Date.now(),
        safetyValidatedAt,
        responseReturnedAt: Date.now(),
        durations: {
          contextConstructionMs: 0,
          geminiCallMs: 0,
          parsingMs: 0,
          safetyValidationMs: Math.max(0, safetyValidatedAt - startedAt),
          totalMs: Math.max(0, Date.now() - startedAt)
        }
      }
    };
  }
}
