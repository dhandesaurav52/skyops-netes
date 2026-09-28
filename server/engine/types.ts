import {
  IncidentSeverity,
  IncidentType,
  KubernetesResource,
  TechnicalDetails
} from '../../src/types/index';

/**
 * SkyOps 7-Tier Provenance & Intelligence Categorization
 */
export type SignalCategory =
  | 'FACT'
  | 'DERIVED_FACT'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'RECOMMENDATION'
  | 'EXECUTABLE_ACTION'
  | 'VERIFIED_RESULT';

export type HypothesisStatus =
  | 'CONFIRMED'
  | 'PLAUSIBLE'
  | 'REFUTED'
  | 'INSUFFICIENT_EVIDENCE';

export interface CorrelatedSignal {
  id: string;
  category: SignalCategory;
  source: 'kubelet' | 'events' | 'metrics' | 'spec' | 'status' | 'engine';
  resourceKind: string;
  resourceName: string;
  namespace?: string;
  property: string;
  value: unknown;
  description: string;
  timestamp: number;
  weight?: number; // 1 to 5 relative significance
}

export type ResourceRelationType =
  | 'OWNED_BY'
  | 'SCHEDULED_ON'
  | 'MOUNTS_PVC'
  | 'BACKED_BY_STORAGE_CLASS'
  | 'EXPOSED_BY_SERVICE'
  | 'ROUTES_TO_POD'
  | 'BACKED_BY_ENDPOINTS'
  | 'CONTROLS_POD'
  | 'PEER_ON_NODE';

export interface ResourceRelationship {
  source: {
    kind: string;
    name: string;
    namespace?: string;
    status?: string;
  };
  target: {
    kind: string;
    name: string;
    namespace?: string;
    status?: string;
  };
  relation: ResourceRelationType;
  details?: string;
  isImpacted?: boolean;
}

export interface EvidencePoint {
  id: string;
  signalId?: string;
  description: string;
  source: string;
  weight: number; // positive for supporting, negative for contradicting
  timestamp?: number;
}

export interface RootCauseHypothesis {
  id: string;
  title: string;
  category: string;
  description: string;
  score: number; // 0 to 100
  status: HypothesisStatus;
  supportingEvidence: EvidencePoint[];
  contradictingEvidence: EvidencePoint[];
  whySelectedOrRejected: string;
}

export interface CorrelatedTimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  category: SignalCategory;
  description: string;
  source: string;
  resourceKind: string;
  resourceName: string;
  temporalDistance?: string;
  relationship?: 'OBSERVED' | 'CORRELATED' | 'LIKELY_RELATED' | 'PLAUSIBLE' | 'UNKNOWN';
  evidenceConfidence?: number;
  confidence?: number;
}

export interface DetectedResourceChange {
  changeId: string;
  changeType?: string;
  resourceKind: string;
  resourceName: string;
  namespace?: string;
  field: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  timestamp: number;
  confidence: number;
  evidence: string;
}

export interface InvestigationQuestionResult {
  question: string;
  answer: string;
  category: string;
  confidence: number;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  supportingEvidence: EvidencePoint[];
  facts: string[];
  inferences: string[];
  unknowns: string[];
  recommendedNextSteps: string[];
}

export interface ExplainabilityReport {
  whySelected: string;
  rejectedAlternatives: Array<{
    id: string;
    title: string;
    reason: string;
    score: number;
  }>;
  evidenceSummary: {
    factCount: number;
    derivedFactCount: number;
    inferenceCount: number;
    supportingScore: number;
    contradictingScore: number;
  };
  missingEvidence?: string[];
}

export interface ExecutableActionProposal {
  actionType: string;
  targetResource: {
    kind: string;
    name: string;
    namespace: string;
    container?: string;
  };
  fieldPath: string;
  currentValue: string;
  proposedValue: string;
  isExecutable: boolean;
  reason: string;
}

export interface IntelligenceAnalysis {
  incidentId: string;
  incidentType: IncidentType;
  fingerprint: string;
  clusterId: string;
  clusterName: string;
  analyzedAt: number;
  rootCause: string;
  rootCauseCategory: string;
  confidence: number; // 0.0 to 1.0
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceExplanation: string;
  primaryHypothesis: RootCauseHypothesis | null;
  evaluatedHypotheses: RootCauseHypothesis[];
  signals: CorrelatedSignal[];
  relationships: ResourceRelationship[];
  correlatedTimeline: CorrelatedTimelineEvent[];
  changes?: DetectedResourceChange[];
  explainability: ExplainabilityReport;
  recommendation: string;
  executableProposal?: ExecutableActionProposal;
  isUnknownOrInconclusive: boolean;
  customerImpact?: string;
  whatRemainsUnknown?: string[];
  whatShouldHappenNext?: string[];
}
