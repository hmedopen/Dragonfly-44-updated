export type SubsystemId =
  | 'app-core'
  | 'scanning-ocr'
  | 'ai-services'
  | 'translation'
  | 'data-storage'
  | 'app-state'
  | 'rendering-ui'
  | 'models-assets'
  | 'electron-fs'
  | 'settings-config'
  | (string & {});

export type DiagnosticHealthStatus =
  | 'healthy'
  | 'warning'
  | 'error'
  | 'critical'
  | 'running'
  | 'not_checked'
  | 'unsupported';

export type DiagnosticSeverity = 'healthy' | 'info' | 'warning' | 'error' | 'critical';

export type DiagnosticEventType =
  | 'lifecycle'
  | 'decision'
  | 'io'
  | 'state_transition'
  | 'error'
  | 'metric'
  | 'check';

export type DiagnosticEventStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'degraded'
  | 'cancelled'
  | 'skipped'
  | 'not_checked'
  | 'unsupported';

export type CheckSafetyLevel = 'read_only' | 'controlled_test' | 'potentially_modifying';

export type CoverageTier = 'full' | 'partial' | 'read_only_check' | 'unsupported';

export interface DiagnosticErrorInfo {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
}

export interface DiagnosticEvent {
  eventId: string;
  seq: number;
  sessionId: string;
  timestamp: number;
  isoTimestamp: string;
  subsystem: SubsystemId;
  component: string;
  operation: string;
  eventType: DiagnosticEventType;
  severity: DiagnosticSeverity;
  status: DiagnosticEventStatus;
  durationMs?: number;
  correlationId?: string;
  parentEventId?: string;
  identifiers?: Record<string, string | number | boolean | undefined>;
  payload?: Record<string, unknown>;
  explanation: string;
  error?: DiagnosticErrorInfo;
  redactedFields?: string[];
}

export interface DiagnosticEventInput {
  subsystem: SubsystemId;
  component: string;
  operation: string;
  eventType: DiagnosticEventType;
  severity: DiagnosticSeverity;
  status: DiagnosticEventStatus;
  durationMs?: number;
  correlationId?: string;
  parentEventId?: string;
  identifiers?: Record<string, string | number | boolean | undefined>;
  payload?: Record<string, unknown>;
  explanation: string;
  error?: unknown;
  timestamp?: number;
  sessionId?: string;
}

export interface DiagnosticFinding {
  findingId: string;
  subsystem: SubsystemId;
  checkId?: string;
  code: string;
  severity: Exclude<DiagnosticSeverity, 'healthy'>;
  title: string;
  explanation: string;
  impact?: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
  correlationId?: string;
  timestamp: number;
}

export interface DiagnosticCheckDefinition {
  checkId: string;
  name: string;
  description: string;
  safety: CheckSafetyLevel;
  defaultEnabled: boolean;
}

export interface DiagnosticCheckResult {
  checkId: string;
  subsystem: SubsystemId;
  name: string;
  safety: CheckSafetyLevel;
  status: Exclude<DiagnosticHealthStatus, 'running' | 'not_checked'>;
  durationMs: number;
  timestamp: number;
  summary: string;
  findings: DiagnosticFinding[];
  metrics?: Record<string, unknown>;
}

export interface CapabilityDeclaration {
  capability: string;
  tier: CoverageTier;
  notes: string;
}

export interface InspectorContext {
  now: number;
  recentEvents: DiagnosticEvent[];
  activeProjectId?: string | null;
  activeChapterId?: string | null;
  activePageId?: string | null;
}

export interface InspectorHealthContext {
  recentEvents: DiagnosticEvent[];
  lastCheckResults: DiagnosticCheckResult[];
  activeOperationsCount: number;
}

export interface SubsystemHealthSnapshot {
  subsystem: SubsystemId;
  name: string;
  description: string;
  coverageLevel: CoverageTier;
  status: DiagnosticHealthStatus;
  hasEvidence: boolean;
  lastCheckedAt: number | null;
  activeOperationsCount: number;
  findings: DiagnosticFinding[];
  checkResults: DiagnosticCheckResult[];
  recentEventCount: number;
  summary: string;
}

export interface SubsystemInspector {
  readonly id: SubsystemId;
  readonly name: string;
  readonly description: string;
  readonly coverageLevel: CoverageTier;
  readonly capabilities: CapabilityDeclaration[];
  readonly checks: DiagnosticCheckDefinition[];
  runCheck: (checkId: string, context: InspectorContext) => Promise<DiagnosticCheckResult>;
  evaluateHealth?: (context: InspectorHealthContext) => SubsystemHealthSnapshot;
}

export interface ActiveOperationRecord {
  correlationId: string;
  subsystem: SubsystemId;
  component: string;
  operation: string;
  startedAt: number;
  lastUpdatedAt: number;
  identifiers?: Record<string, string | number | boolean | undefined>;
  explanation: string;
}

export interface RecordingPrivacyOptions {
  includeExtractedText: boolean;
  includeDetailedPayloads: boolean;
}

export interface PrivacyManifest {
  apiKeysAndSecretsRedacted: true;
  sourceImagesExcluded: true;
  includeExtractedText: boolean;
  includeDetailedPayloads: boolean;
  totalRedactedFields: number;
  notes: string[];
}

export interface DiagnosticSessionMetadata {
  sessionId: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  status: 'recording' | 'stopped' | 'recovered';
  privacyOptions: RecordingPrivacyOptions;
  privacyManifest: PrivacyManifest;
  eventCount: number;
  droppedEventCount: number;
  truncated: boolean;
  pagesCovered: string[];
  operationsCovered: string[];
  subsystemsSeen: SubsystemId[];
  findingsCount: number;
  maxEventsCap: number;
}

export interface DiagnosticSessionRecord {
  metadata: DiagnosticSessionMetadata;
  events: DiagnosticEvent[];
  systemSnapshots: SubsystemHealthSnapshot[];
}

export interface CorrelatedTrace {
  correlationId: string;
  rootSubsystem: SubsystemId;
  rootOperation: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  outcome: 'succeeded' | 'degraded' | 'failed' | 'cancelled' | 'running';
  subsystemsInvolved: SubsystemId[];
  events: DiagnosticEvent[];
  rootCauseEventId?: string;
  rootCauseSummary?: string;
  affectedComponents: string[];
  summary: string;
}

export interface InstrumentationCoverageEntry {
  subsystem: SubsystemId;
  name: string;
  tier: CoverageTier;
  capabilities: CapabilityDeclaration[];
}

export interface HumanReport {
  title: string;
  generatedAt: string;
  sessionId: string;
  overallStatus: DiagnosticHealthStatus;
  executiveSummary: string;
  subsystemSummaries: Array<{
    subsystem: SubsystemId;
    name: string;
    status: DiagnosticHealthStatus;
    summary: string;
    findingCount: number;
  }>;
  operationNarratives: Array<{
    correlationId: string;
    title: string;
    outcome: string;
    narrative: string;
  }>;
  failureAnalyses: Array<{
    findingOrTraceId: string;
    origin: string;
    consequence: string;
    affectedComponents: string[];
    explanation: string;
  }>;
  coverageNotes: string[];
  privacyDisclosure: string[];
  markdown: string;
}

export interface TechnicalReport {
  schemaVersion: '1.0';
  reportType: 'folio_script_system_diagnostic_report';
  generatedAt: string;
  metadata: {
    sessionId: string;
    sessionStatus: DiagnosticSessionMetadata['status'] | 'snapshot';
    startedAt: number;
    endedAt: number | null;
    durationMs: number;
    eventCount: number;
    droppedEventCount: number;
    truncated: boolean;
    pagesCovered: string[];
    operationsCovered: string[];
  };
  privacyManifest: PrivacyManifest;
  overallStatus: DiagnosticHealthStatus;
  systemHealth: SubsystemHealthSnapshot[];
  findings: DiagnosticFinding[];
  correlatedTraces: CorrelatedTrace[];
  timeline: DiagnosticEvent[];
  settingsSnapshot: Record<string, unknown>;
  instrumentationCoverage: InstrumentationCoverageEntry[];
  environment: Record<string, unknown>;
}

export interface DualDiagnosticReport {
  human: HumanReport;
  technical: TechnicalReport;
}
