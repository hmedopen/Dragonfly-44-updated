/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Canonical Data Contracts
 *
 * Defines the complete review evidence model, confidence dimensions,
 * finding schemas, issue codes, snapshot structures, correction transactions,
 * and review audit records.
 */

import type { BubbleItem } from './workbench';
import type { PageScanResult } from './scanning';

export type ReviewDomain =
  | 'visual'
  | 'ocr'
  | 'geometry'
  | 'association'
  | 'reading_order'
  | 'classification'
  | 'translation'
  | 'integrity'
  | 'cross_layer';

export type ReviewSeverity = 'critical' | 'major' | 'moderate' | 'minor' | 'informational';

export type FindingStatus = 'open' | 'accepted' | 'rejected' | 'corrected' | 'unresolved' | 'stale';

export type ReviewAction = 'none' | 'inspect' | 'edit' | 're_run_stage' | 'accept' | 'correct';

export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'uncertain' | 'not_assessed';

export interface ConfidenceDimensions {
  sourceOCR: ConfidenceLevel;
  finding: ConfidenceLevel;
  correction: ConfidenceLevel;
  detection?: ConfidenceLevel;
  association?: ConfidenceLevel;
  readingOrder?: ConfidenceLevel;
  classification?: ConfidenceLevel;
  translationUnderstanding?: ConfidenceLevel;
}

export type EntityType = 'page' | 'panel' | 'region' | 'bubble' | 'translation' | 'cross_layer';

export interface AffectedEntity {
  type: EntityType;
  pageId: string;
  chapterId?: string;
  panelId?: string;
  regionId?: string;
  bubbleId?: string;
  translationVersionId?: string;
  textSpan?: [number, number]; // [startOffset, endOffset]
}

export interface FindingEvidence {
  sourceCropRef?: string;
  sourceSpan?: string;
  translationSpan?: string;
  detectedOCR?: string;
  ocrAlternative?: string;
  geometryData?: any;
  transformData?: any;
  rationale: string;
}

export interface ProposedCorrection {
  correctionId: string;
  targetField: 'translatedText' | 'sourceText' | 'type' | 'orderIndex' | 'geometry';
  currentValue: any;
  suggestedValue: any;
  isEligibleForAuto: boolean;
  autoEligibilityReason?: string;
  validationStatus: 'pending' | 'validated' | 'invalid';
  validationErrors?: string[];
}

export interface ReviewFinding {
  findingId: string;
  domain: ReviewDomain;
  issueCode: string;
  severity: ReviewSeverity;
  status: FindingStatus;
  affectedEntity: AffectedEntity;
  observation: string;
  expectedBehavior: string;
  evidence: FindingEvidence;
  confidence: ConfidenceDimensions;
  proposedAction: ReviewAction;
  proposedCorrection?: ProposedCorrection;
  ruleVersion: string;
  modelVersion?: string;
  relatedFindingIds?: string[];
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: 'user' | 'system';
  resolutionDetail?: string;
  snapshotVersion: string;
}

export interface ReviewSnapshot {
  snapshotId: string;
  pageId: string;
  chapterId?: string;
  versionHash: string;
  timestamp: number;
  scanResult: PageScanResult | null;
  bubbles: BubbleItem[];
  activeInstructionsHash: string;
  manualDecisions: Array<{
    entityId: string;
    type: 'typer' | 'sourceText' | 'translatedText' | 'geometry' | 'order';
    value: any;
    updatedAt: number;
  }>;
}

export interface ReviewAuditRecord {
  auditId: string;
  jobId: string;
  timestamp: number;
  snapshotId: string;
  affectedEntity: AffectedEntity;
  beforeState: any;
  afterState: any;
  findingId: string;
  action: string;
  actor: 'user' | 'system';
  ruleVersion: string;
  modelVersion?: string;
}

export type ReviewStrictness = 'conservative' | 'balanced' | 'thorough';

export interface ReviewJobResult {
  jobId: string;
  scope: 'single_bubble' | 'single_page' | 'chapter';
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  strictness: ReviewStrictness;
  pageSummaries: Record<string, string>;
  chapterSummary?: string;
  findings: ReviewFinding[];
  counts: {
    passed: number;
    flagged: number;
    corrected: number;
    blocked: number;
    failed: number;
    skipped: number;
    notApplicable: number;
  };
  snapshotId: string;
  errors?: string[];
}

/**
 * Standard Issue Code Families for System #4
 */
export const ISSUE_CODES = {
  // OCR & Visual
  OCR_OMISSION: 'OCR_OMISSION',
  OCR_SUBSTITUTION: 'OCR_SUBSTITUTION',
  OCR_DUPLICATE_LINE: 'OCR_DUPLICATE_LINE',
  REGION_MERGE_SUSPECTED: 'REGION_MERGE_SUSPECTED',
  TEXT_CLIPPED: 'TEXT_CLIPPED',
  MISSED_TEXT_IN_ART: 'MISSED_TEXT_IN_ART',
  SOURCE_LIMITED_UNCERTAINTY: 'SOURCE_LIMITED_UNCERTAINTY',

  // Geometry & Transforms
  REGION_OUT_OF_BOUNDS: 'REGION_OUT_OF_BOUNDS',
  TRANSFORM_MISMATCH: 'TRANSFORM_MISMATCH',
  OVERLAY_ALIGNMENT_ERROR: 'OVERLAY_ALIGNMENT_ERROR',
  BOX_INVERTED_COORDINATES: 'BOX_INVERTED_COORDINATES',

  // Association & Reading Order
  WRONG_BUBBLE_ASSOCIATION: 'WRONG_BUBBLE_ASSOCIATION',
  PANEL_LINK_AMBIGUOUS: 'PANEL_LINK_AMBIGUOUS',
  ORPHAN_TEXT_REGION: 'ORPHAN_TEXT_REGION',
  ORDER_INDEX_DUPLICATE: 'ORDER_INDEX_DUPLICATE',
  ORDER_SEQUENCE_GAP: 'ORDER_SEQUENCE_GAP',
  PANEL_SEQUENCE_CONFLICT: 'PANEL_SEQUENCE_CONFLICT',
  REGION_ORDER_AMBIGUOUS: 'REGION_ORDER_AMBIGUOUS',

  // Classification
  TEXT_TYPE_MISMATCH: 'TEXT_TYPE_MISMATCH',
  SFX_VOCALIZATION_AMBIGUOUS: 'SFX_VOCALIZATION_AMBIGUOUS',
  GENERIC_CLASS_UNCERTAIN: 'GENERIC_CLASS_UNCERTAIN',

  // Translation & Linguistic
  MISSING_TRANSLATION: 'MISSING_TRANSLATION',
  MEANING_OMISSION: 'MEANING_OMISSION',
  MEANING_ADDITION: 'MEANING_ADDITION',
  POSSIBLE_NEGATION_MISMATCH: 'POSSIBLE_NEGATION_MISMATCH',
  TONE_MISMATCH: 'TONE_MISMATCH',
  DIALECT_OVERRIDE_VIOLATION: 'DIALECT_OVERRIDE_VIOLATION',
  MASTER_PROMPT_VIOLATION: 'MASTER_PROMPT_VIOLATION',
  GENDER_AGREEMENT_MISMATCH: 'GENDER_AGREEMENT_MISMATCH',
  CHARACTER_VOICE_INCONSISTENCY: 'CHARACTER_VOICE_INCONSISTENCY',
  NAME_INCONSISTENCY: 'NAME_INCONSISTENCY',
  TERMINOLOGY_INCONSISTENCY: 'TERMINOLOGY_INCONSISTENCY',
  GRAMMAR_ERROR: 'GRAMMAR_ERROR',
  ORTHOGRAPHY_ERROR: 'ORTHOGRAPHY_ERROR',
  NATURALNESS_SUGGESTION: 'NATURALNESS_SUGGESTION',

  // Integrity & Concurrency
  STALE_SOURCE_REFERENCE: 'STALE_SOURCE_REFERENCE',
  MANUAL_DECISION_OVERWRITE_RISK: 'MANUAL_DECISION_OVERWRITE_RISK',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  STALE_SNAPSHOT: 'STALE_SNAPSHOT',
  CONCURRENT_EDIT_CONFLICT: 'CONCURRENT_EDIT_CONFLICT',

  // Execution
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  MALFORMED_REVIEW_RESPONSE: 'MALFORMED_REVIEW_RESPONSE',
  CORRECTION_VALIDATION_FAILED: 'CORRECTION_VALIDATION_FAILED',
} as const;
