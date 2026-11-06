/**
 * Dragonfly 44: System #5 — Project Memory & AI Data Integrity Engine
 * Unified Domain Models, Data Contracts, Taxonomies, and Error Codes
 */

// ----------------------------------------------------
// Taxonomy & Controlled Vocabulary
// ----------------------------------------------------

export type RecordType =
  | 'glossary_term'
  | 'character_profile'
  | 'lore_fact'
  | 'relationship'
  | 'continuity_event'
  | 'user_note';

export type RecordStatus =
  | 'candidate'
  | 'pending_approval'
  | 'approved'
  | 'disputed'
  | 'superseded'
  | 'rejected'
  | 'archived'
  | 'quarantined'
  | 'needs_evidence';

export type TrustClass =
  | 'user_confirmed'
  | 'imported_user_data'
  | 'system_observed'
  | 'model_inferred';

export type CandidateReviewState =
  | 'new'
  | 'needs_evidence'
  | 'ready_for_approval'
  | 'accepted'
  | 'rejected'
  | 'merged'
  | 'quarantined';

export type ExtractionMethod =
  | 'ocr'
  | 'model_inference'
  | 'explicit_user_entry'
  | 'deterministic_rule'
  | 'import';

export type ConflictType =
  | 'value_conflict'
  | 'temporal_conflict'
  | 'scope_conflict'
  | 'identity_conflict'
  | 'source_conflict'
  | 'stale_write_conflict';

export type ScopeLevel = 'project' | 'series' | 'chapter' | 'page' | 'entity';

export interface KnowledgeScope {
  level: ScopeLevel;
  id?: string;
  project_id?: string;
  series_id?: string;
  chapter_id?: string;
  page_id?: string;
  entity_id?: string;
}

export interface ConfidenceComponents {
  source_reliability?: number;   // 0.0 - 1.0 (e.g. user edit = 1.0, noisy OCR = 0.5)
  extraction?: number;           // 0.0 - 1.0 OCR/text reading certainty
  interpretation?: number;       // 0.0 - 1.0 semantic/inference certainty
  identity?: number;             // 0.0 - 1.0 entity matching certainty
  temporal?: number;             // 0.0 - 1.0 timeliness/currency
}

export interface KnowledgeProvenance {
  producer: string;              // Subsystem or actor, e.g. 'system_3', 'system_2', 'user'
  producer_version?: string;     // e.g. 'gemini-3.8-flash', 'system3-v1.0'
  run_id?: string;               // Operation run identifier
  source_refs: string[];         // e.g. ['page:12:bubble:4', 'file:notes.txt']
  extraction_method: ExtractionMethod;
  timestamp: number;             // UTC millisecond timestamp
  evidence_excerpt?: string;     // Minimal bounded raw excerpt
  source_revision?: string | number;
}

// ----------------------------------------------------
// Logical Payloads
// ----------------------------------------------------

export interface GlossaryTermPayload {
  source_form: string;
  approved_rendering: string;
  aliases?: string[];
  language_pair?: string;        // e.g. 'ja-ar', 'ko-ar', 'zh-ar'
  usage_note?: string;
  forbidden_variants?: string[];
  category?: 'term' | 'technique' | 'place' | 'title' | 'organization' | 'cultivation' | string;
}

export interface CharacterProfilePayload {
  canonical_name: string;
  aliases?: string[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  title?: string;
  confirmed_facts?: string[];
  voice_profile?: {
    traits?: string[];
    evidence_refs?: string[];
    status?: 'candidate_guidance' | 'approved_guidance';
  };
  relationships?: Array<{
    target: string;
    type: string;
    tone?: string;
    pronouns?: string;
    hierarchy?: 'superior' | 'equal' | 'subordinate';
  }>;
}

export interface LoreFactPayload {
  assertion: string;
  category?: 'world_rule' | 'historical_event' | 'location_fact' | 'magic_system' | string;
  confirmed_facts?: string[];
  notes?: string;
}

export interface RelationshipPayload {
  speaker: string;
  addressee: string;
  relationship_type?: string;
  tone?: string;
  pronouns?: string;             // e.g. "أنتَ" vs "أنتِ", "حضرتك"
  hierarchy?: 'superior' | 'equal' | 'subordinate';
  valid_time_range?: string;
}

export interface ContinuityEventPayload {
  event_name: string;
  chapter_id?: string;
  page_index?: number;
  description: string;
  timeline_anchor?: string;
  affected_entities?: string[];
}

export interface UserNotePayload {
  note_text: string;
  category?: string;
  priority?: 'low' | 'normal' | 'high';
  is_instruction_override?: boolean; // Classified as data by default; explicit flag required for instructions
}

export type KnowledgePayload =
  | GlossaryTermPayload
  | CharacterProfilePayload
  | LoreFactPayload
  | RelationshipPayload
  | ContinuityEventPayload
  | UserNotePayload
  | Record<string, any>;

// ----------------------------------------------------
// Canonical Record Envelope
// ----------------------------------------------------

export interface KnowledgeRecord<T = KnowledgePayload> {
  record_id: string;             // Unique stable ID (e.g. 'rec-term-01')
  record_type: RecordType;
  project_id: string;
  scope: KnowledgeScope;
  canonical_key: string;         // Normalized identity key (e.g. 'term:shadow-step', 'character:ren')
  payload: T;
  status: RecordStatus;
  trust_class: TrustClass;
  confidence?: ConfidenceComponents;
  provenance: KnowledgeProvenance[];
  revision: number;              // Monotonic revision counter (starts at 1)
  schema_version: string;        // Payload contract version (e.g. '1.0')
  created_at: number;            // UTC ms
  updated_at: number;            // UTC ms
  created_by: string;            // Actor or producer ID
  updated_by: string;
  valid_from?: number | string;  // Temporal validity
  valid_to?: number | string;
  supersedes?: string[];         // Record IDs superseded
  conflicts_with?: string[];     // Conflicting record IDs
}

// ----------------------------------------------------
// Candidate Envelope
// ----------------------------------------------------

export interface KnowledgeCandidate<T = KnowledgePayload> {
  candidate_id: string;
  project_id: string;
  proposed_record: KnowledgeRecord<T>;
  producer: string;              // 'system_3' | 'system_2' | 'system_4' | 'user' | 'import'
  source_refs: string[];
  evidence_excerpt?: string;
  extraction_method: ExtractionMethod;
  confidence_components: ConfidenceComponents;
  dedupe_key: string;            // project_id + record_type + canonical_key + scope_level
  review_state: CandidateReviewState;
  created_at: number;
  idempotency_key: string;
}

// ----------------------------------------------------
// Revisions & Audit Log
// ----------------------------------------------------

export interface KnowledgeRevision {
  revision_id: string;           // 'rev-{record_id}-{revision}'
  record_id: string;
  project_id: string;
  revision: number;
  snapshot_data: KnowledgeRecord;
  changed_by: string;
  timestamp: number;
  change_reason?: string;
  previous_revision?: number;
}

export type AuditEventType =
  | 'CandidateCreated'
  | 'CandidateDeduplicated'
  | 'CandidateQuarantined'
  | 'CandidateRejected'
  | 'CandidateApproved'
  | 'CandidateReopened'
  | 'CandidateMerged'
  | 'RecordCreated'
  | 'RecordRevised'
  | 'RecordSuperseded'
  | 'RecordArchived'
  | 'ConflictDetected'
  | 'ConflictResolved'
  | 'StaleWriteRejected'
  | 'ContextSnapshotCreated'
  | 'ContextRetrievalIncomplete'
  | 'SchemaValidationFailed'
  | 'ProvenanceValidationFailed'
  | 'MigrationStarted'
  | 'MigrationCompleted'
  | 'MigrationRolledBack'
  | 'IntegrityCheckCompleted';

export interface KnowledgeAuditEvent {
  event_id: string;
  event_type: AuditEventType;
  project_id: string;
  record_id?: string;
  candidate_id?: string;
  actor: string;
  operation_id?: string;
  correlation_id?: string;
  before_revision?: number;
  after_revision?: number;
  decision_reason: string;
  source_refs?: string[];
  timestamp: number;
  result: 'success' | 'rejected' | 'conflict' | 'rollback' | 'quarantined';
}

// ----------------------------------------------------
// Conflict Management
// ----------------------------------------------------

export interface AssertionClaim {
  assertion_id: string;
  value: any;
  field_path?: string;
  provenance: KnowledgeProvenance[];
  confidence?: ConfidenceComponents;
  trust_class: TrustClass;
  status: 'active' | 'defeated' | 'withdrawn';
}

export interface KnowledgeConflictSet {
  conflict_id: string;
  project_id: string;
  record_id?: string;
  canonical_key: string;
  conflict_type: ConflictType;
  field_path?: string;
  assertions: AssertionClaim[];
  detected_at: number;
  status: 'unresolved' | 'resolved';
  resolved_by?: string;
  resolved_at?: number;
  resolution_decision?: string;
}

// ----------------------------------------------------
// Quarantine Storage
// ----------------------------------------------------

export interface KnowledgeQuarantineItem {
  quarantine_id: string;
  project_id: string;
  producer: string;
  raw_payload: any;
  reason_code: string;
  reason_details: string;
  source_refs: string[];
  timestamp: number;
  resolved: boolean;
}

// ----------------------------------------------------
// Context Retrieval Contracts
// ----------------------------------------------------

export interface RetrievalRequest {
  project_id: string;
  consumer: 'translation' | 'scan_interpretation' | 'review' | 'ui' | 'export' | string;
  operation_id: string;
  scope: KnowledgeScope;
  query_entities?: string[];
  requested_record_types?: RecordType[];
  max_items?: number;
  token_budget?: number;
  as_of_revision?: number;
  include_candidates?: boolean;  // Default false; candidates excluded from authoritative translation context
}

export interface ContextItem {
  record_id: string;
  record_type: RecordType;
  canonical_key: string;
  revision: number;
  scope: KnowledgeScope;
  status: RecordStatus;
  authority_label: TrustClass;
  content: Record<string, any>;
  provenance_refs: string[];
  retrieval_reason: 'exact_term_match' | 'entity_alias_match' | 'scoped_lore' | 'active_speaker' | 'fallback_context';
  snapshot_revision: number;
}

export interface ContextBundle {
  consumer: string;
  operation_id: string;
  scope: KnowledgeScope;
  snapshot_revision: number;
  items: ContextItem[];
  conflicts: Array<{
    conflict_id: string;
    canonical_key: string;
    description: string;
  }>;
  token_estimate: number;
  is_complete: boolean;
  warnings?: string[];
}

// ----------------------------------------------------
// System #6 Policy & Settings Hooks
// ----------------------------------------------------

export type MemoryLearningMode = 'candidate_only' | 'auto_approve_low_risk' | 'disabled';
export type ApprovalStrictness = 'all_proposals' | 'model_inferred_and_conflicts' | 'conflicts_only';
export type AutoMergePolicy = 'conservative' | 'strict';

export interface ProjectMemorySettings {
  project_id: string;
  learning_mode: MemoryLearningMode;          // Default 'candidate_only'
  approval_strictness: ApprovalStrictness;    // Default 'model_inferred_and_conflicts'
  cross_chapter_learning: boolean;            // Default true
  candidate_retention_days: number;           // Default 30
  context_budget_tokens: number;              // Default 2000
  conflict_notifications: boolean;            // Default true
  auto_merge_policy: AutoMergePolicy;         // Default 'conservative'
  history_retention_revisions: number;        // Default 50
  updated_at: number;
}

export const DEFAULT_PROJECT_MEMORY_SETTINGS: Omit<ProjectMemorySettings, 'project_id'> = {
  learning_mode: 'candidate_only',
  approval_strictness: 'model_inferred_and_conflicts',
  cross_chapter_learning: true,
  candidate_retention_days: 30,
  context_budget_tokens: 2000,
  conflict_notifications: true,
  auto_merge_policy: 'conservative',
  history_retention_revisions: 50,
  updated_at: 0,
};

// ----------------------------------------------------
// Recommended Issue / Error Codes (Appendix A)
// ----------------------------------------------------

export const MEMORY_ISSUE_CODES = {
  INVALID_PROPOSAL_ENVELOPE: 'MEM-001',
  UNSUPPORTED_SCHEMA_VERSION: 'MEM-002',
  MISSING_PROVENANCE: 'MEM-003',
  SOURCE_REF_NOT_FOUND: 'MEM-004',
  CROSS_PROJECT_REFERENCE: 'MEM-005',
  CANONICAL_IDENTITY_AMBIGUOUS: 'MEM-006',
  DUPLICATE_PROPOSAL: 'MEM-007',
  PROTECTED_USER_DATA_CONFLICT: 'MEM-008',
  STALE_REVISION: 'MEM-009',
  ILLEGAL_STATE_TRANSITION: 'MEM-010',
  SEMANTIC_VALIDATION_FAILED: 'MEM-011',
  CONTEXT_SNAPSHOT_INCOMPLETE: 'MEM-012',
  AUDIT_TRANSACTION_FAILED: 'MEM-013',
  MIGRATION_VALIDATION_FAILED: 'MEM-014',
  PAYLOAD_LIMIT_EXCEEDED: 'MEM-015',
  UNTRUSTED_INSTRUCTION_DETECTED: 'MEM-016',
} as const;

export type MemoryIssueCode = (typeof MEMORY_ISSUE_CODES)[keyof typeof MEMORY_ISSUE_CODES];

// ----------------------------------------------------
// Structured Service Result Contract
// ----------------------------------------------------

export type ResultStatus =
  | 'success'
  | 'invalid'
  | 'conflict'
  | 'unauthorized'
  | 'not_found'
  | 'retryable_failure'
  | 'incomplete';

export interface ResultError {
  code: MemoryIssueCode | string;
  path?: string;
  message: string;
  retryable?: boolean;
}

export interface MemoryResult<T = any> {
  status: ResultStatus;
  data: T | null;
  errors: ResultError[];
  correlation_id: string;
  snapshot_revision?: number;
}
