/**
 * Folio Script: System #5 — Candidate Intake Pipeline
 * 
 * Ingestion pipeline for candidate knowledge proposals from System #3 (scans),
 * System #2 (translations), System #4 (reviews), user notes, and imports.
 * Enforces producer authorization, idempotency, envelope validation,
 * normalization, deduplication, conflict detection, and quarantine isolation.
 */

import type {
  KnowledgeRecord,
  KnowledgeCandidate,
  RecordType,
  KnowledgeScope,
  ConfidenceComponents,
  KnowledgeAuditEvent,
  KnowledgeQuarantineItem,
  ResultError,
  MemoryResult,
  KnowledgeConflictSet,
} from '../../types/memory';
import { MEMORY_ISSUE_CODES } from '../../types/memory';
import {
  generateCanonicalKey,
  generateDedupeKey,
  generateIdempotencyKey,
  normalizeUnicodeText,
} from './memoryNormalization';
import { validateKnowledgeRecord } from './memoryValidator';
import { getMemoryDriver } from '../../services/memoryRepository';

export interface ProposedKnowledgeItem {
  record_type: RecordType;
  scope: KnowledgeScope;
  canonical_name?: string;
  canonical_key?: string;
  payload: Record<string, any>;
  source_refs: string[];
  evidence_excerpt?: string;
  confidence?: ConfidenceComponents;
  source_revision?: string | number;
}

export interface IntakeProposalEnvelope {
  contract: 'dragonfly.memory.proposal';
  schema_version: '1.0';
  producer: string;              // 'system_3' | 'system_2' | 'system_4' | 'user' | 'import'
  project_id: string;
  operation_id: string;
  base_snapshot_revision?: number;
  proposals: ProposedKnowledgeItem[];
}

export interface CandidateIntakeOutcome {
  accepted: KnowledgeCandidate[];
  deduplicated: KnowledgeCandidate[];
  conflicts: KnowledgeConflictSet[];
  quarantined: KnowledgeQuarantineItem[];
  rejected: Array<{ proposal: ProposedKnowledgeItem; errors: ResultError[] }>;
}

const AUTHORIZED_PRODUCERS = new Set([
  'system_3',
  'system_2',
  'system_4',
  'user',
  'import',
  'internal_engine',
]);

/**
 * Validates producer authorization.
 */
export function isAuthorizedProducer(producer: string): boolean {
  return AUTHORIZED_PRODUCERS.has(producer);
}

/**
 * Ingests an intake proposal envelope through the strict System #5 pipeline.
 */
export async function ingestKnowledgeProposals(
  envelope: IntakeProposalEnvelope
): Promise<MemoryResult<CandidateIntakeOutcome>> {
  const correlationId = envelope.operation_id || `op-${Date.now()}`;
  const driver = getMemoryDriver();
  const outcome: CandidateIntakeOutcome = {
    accepted: [],
    deduplicated: [],
    conflicts: [],
    quarantined: [],
    rejected: [],
  };

  // 1. Validate Producer
  if (!envelope.producer || !isAuthorizedProducer(envelope.producer)) {
    return {
      status: 'unauthorized',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `Unauthorized knowledge producer: "${envelope.producer}"`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  // 2. Validate Project ID & Envelope Format
  if (!envelope.project_id || typeof envelope.project_id !== 'string') {
    return {
      status: 'invalid',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: 'Missing required envelope field: project_id',
        },
      ],
      correlation_id: correlationId,
    };
  }

  if (envelope.contract !== 'dragonfly.memory.proposal' || envelope.schema_version !== '1.0') {
    return {
      status: 'invalid',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.UNSUPPORTED_SCHEMA_VERSION,
          message: `Unsupported contract "${envelope.contract}" or schema version "${envelope.schema_version}"`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  if (!Array.isArray(envelope.proposals) || envelope.proposals.length === 0) {
    return {
      status: 'success',
      data: outcome,
      errors: [],
      correlation_id: correlationId,
    };
  }

  // 3. Process Each Proposed Knowledge Item
  for (const item of envelope.proposals) {
    // Generate/Validate Canonical Key
    const rawKey =
      item.canonical_key ||
      item.canonical_name ||
      item.payload.canonical_name ||
      item.payload.source_form ||
      item.payload.termOriginal ||
      item.payload.nameOriginal ||
      item.payload.assertion ||
      item.payload.speaker ||
      'unnamed';

    const canonicalKey = item.canonical_key || generateCanonicalKey(item.record_type, rawKey);

    // Compute Idempotency Key
    const idempotencyKey = generateIdempotencyKey(
      envelope.producer,
      envelope.operation_id,
      item.source_refs || [],
      item.record_type,
      canonicalKey,
      item.source_revision
    );

    // Check Idempotency Cache
    const cachedResult = await driver.getIdempotencyRecord(idempotencyKey);
    if (cachedResult) {
      if (cachedResult.candidate) {
        outcome.deduplicated.push(cachedResult.candidate);
      }
      continue;
    }

    // Check Scope Project Matching
    if (item.scope && item.scope.project_id && item.scope.project_id !== envelope.project_id) {
      const qItem: KnowledgeQuarantineItem = {
        quarantine_id: `quar-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        project_id: envelope.project_id,
        producer: envelope.producer,
        raw_payload: item,
        reason_code: MEMORY_ISSUE_CODES.CROSS_PROJECT_REFERENCE,
        reason_details: `Proposal scope project_id (${item.scope.project_id}) does not match envelope project_id (${envelope.project_id})`,
        source_refs: item.source_refs || [],
        timestamp: Date.now(),
        resolved: false,
      };
      await driver.saveQuarantineItem(qItem);
      outcome.quarantined.push(qItem);
      continue;
    }

    // Ensure Scope Defaults to Project if not specified
    const effectiveScope: KnowledgeScope = item.scope || {
      level: 'project',
      project_id: envelope.project_id,
    };

    // Construct Canonical Proposed Record
    const extractionMethod =
      envelope.producer === 'system_3'
        ? 'ocr'
        : envelope.producer === 'user'
        ? 'explicit_user_entry'
        : envelope.producer === 'import'
        ? 'import'
        : 'model_inference';

    const trustClass =
      envelope.producer === 'user'
        ? 'user_confirmed'
        : envelope.producer === 'import'
        ? 'imported_user_data'
        : envelope.producer === 'system_3'
        ? 'system_observed'
        : 'model_inferred';

    const proposedRecord: KnowledgeRecord = {
      record_id: `rec-${item.record_type}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      record_type: item.record_type,
      project_id: envelope.project_id,
      scope: effectiveScope,
      canonical_key: canonicalKey,
      payload: item.payload,
      status: 'candidate',
      trust_class: trustClass,
      confidence: item.confidence || {
        source_reliability: envelope.producer === 'user' ? 1.0 : 0.8,
        extraction: 0.85,
        interpretation: 0.8,
        identity: 0.85,
      },
      provenance: [
        {
          producer: envelope.producer,
          run_id: envelope.operation_id,
          source_refs: item.source_refs || [],
          extraction_method: extractionMethod,
          timestamp: Date.now(),
          evidence_excerpt: item.evidence_excerpt ? normalizeUnicodeText(item.evidence_excerpt) : undefined,
          source_revision: item.source_revision,
        },
      ],
      revision: 1,
      schema_version: '1.0',
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: envelope.producer,
      updated_by: envelope.producer,
    };

    // Schema & Semantic Validation
    const validation = validateKnowledgeRecord(proposedRecord);
    if (!validation.valid) {
      // If critical schema failure, quarantine
      const isMissingProv = validation.errors.some((e) => e.code === MEMORY_ISSUE_CODES.MISSING_PROVENANCE);
      if (isMissingProv) {
        // Missing provenance moves to needs_evidence review_state rather than hard rejection
        proposedRecord.status = 'needs_evidence';
      } else {
        const qItem: KnowledgeQuarantineItem = {
          quarantine_id: `quar-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          project_id: envelope.project_id,
          producer: envelope.producer,
          raw_payload: item,
          reason_code: validation.errors[0]?.code || MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          reason_details: validation.errors.map((e) => e.message).join('; '),
          source_refs: item.source_refs || [],
          timestamp: Date.now(),
          resolved: false,
        };
        await driver.saveQuarantineItem(qItem);
        outcome.quarantined.push(qItem);
        outcome.rejected.push({ proposal: item, errors: validation.errors });
        continue;
      }
    }

    // Check for Protected User-Data Conflict
    const existingApproved = await driver.getRecordsByCanonicalKey(envelope.project_id, canonicalKey);
    const userConfirmedRecord = existingApproved.find((r) => r.trust_class === 'user_confirmed');

    if (userConfirmedRecord && envelope.producer !== 'user') {
      // Model proposal attempts to mutate a user-confirmed field -> DO NOT SILENTLY OVERWRITE!
      const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const conflictSet: KnowledgeConflictSet = {
        conflict_id: conflictId,
        project_id: envelope.project_id,
        record_id: userConfirmedRecord.record_id,
        canonical_key: canonicalKey,
        conflict_type: 'value_conflict',
        detected_at: Date.now(),
        status: 'unresolved',
        assertions: [
          {
            assertion_id: `as-${userConfirmedRecord.record_id}-1`,
            value: userConfirmedRecord.payload,
            provenance: userConfirmedRecord.provenance,
            trust_class: 'user_confirmed',
            status: 'active',
          },
          {
            assertion_id: `as-prop-${Date.now()}`,
            value: item.payload,
            provenance: proposedRecord.provenance,
            trust_class: 'model_inferred',
            status: 'active',
          },
        ],
      };
      await driver.saveConflict(conflictSet);
      outcome.conflicts.push(conflictSet);

      // Audit conflict detection
      const auditEvent: KnowledgeAuditEvent = {
        event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        event_type: 'ConflictDetected',
        project_id: envelope.project_id,
        record_id: userConfirmedRecord.record_id,
        actor: envelope.producer,
        operation_id: envelope.operation_id,
        correlation_id: correlationId,
        decision_reason: `Proposal from ${envelope.producer} conflicts with protected user-confirmed record`,
        source_refs: item.source_refs,
        timestamp: Date.now(),
        result: 'conflict',
      };
      await driver.saveAuditEvent(auditEvent);
      continue;
    }

    // Deduplication Check
    const dedupeKey = generateDedupeKey(
      envelope.project_id,
      item.record_type,
      canonicalKey,
      effectiveScope.level,
      effectiveScope.id
    );

    const existingCandidate = await driver.getCandidateByDedupeKey(envelope.project_id, dedupeKey);
    if (existingCandidate) {
      // Append provenance to existing candidate
      existingCandidate.source_refs = Array.from(
        new Set([...existingCandidate.source_refs, ...(item.source_refs || [])])
      );
      if (item.evidence_excerpt && !existingCandidate.evidence_excerpt) {
        existingCandidate.evidence_excerpt = item.evidence_excerpt;
      }
      await driver.saveCandidate(existingCandidate);
      await driver.saveIdempotencyRecord(idempotencyKey, { candidate: existingCandidate });
      outcome.deduplicated.push(existingCandidate);

      const auditEvent: KnowledgeAuditEvent = {
        event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        event_type: 'CandidateDeduplicated',
        project_id: envelope.project_id,
        candidate_id: existingCandidate.candidate_id,
        actor: envelope.producer,
        operation_id: envelope.operation_id,
        correlation_id: correlationId,
        decision_reason: `Merged provenance into existing candidate ${existingCandidate.candidate_id}`,
        source_refs: item.source_refs,
        timestamp: Date.now(),
        result: 'success',
      };
      await driver.saveAuditEvent(auditEvent);
      continue;
    }

    // Construct New Candidate
    const candidateId = `cand-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const candidate: KnowledgeCandidate = {
      candidate_id: candidateId,
      project_id: envelope.project_id,
      proposed_record: proposedRecord,
      producer: envelope.producer,
      source_refs: item.source_refs || [],
      evidence_excerpt: item.evidence_excerpt,
      extraction_method: extractionMethod,
      confidence_components: proposedRecord.confidence || {},
      dedupe_key: dedupeKey,
      review_state: proposedRecord.status === 'needs_evidence' ? 'needs_evidence' : 'ready_for_approval',
      created_at: Date.now(),
      idempotency_key: idempotencyKey,
    };

    await driver.saveCandidate(candidate);
    await driver.saveIdempotencyRecord(idempotencyKey, { candidate });
    outcome.accepted.push(candidate);

    const auditEvent: KnowledgeAuditEvent = {
      event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      event_type: 'CandidateCreated',
      project_id: envelope.project_id,
      candidate_id: candidateId,
      actor: envelope.producer,
      operation_id: envelope.operation_id,
      correlation_id: correlationId,
      decision_reason: `Created new ${item.record_type} candidate "${canonicalKey}"`,
      source_refs: item.source_refs,
      timestamp: Date.now(),
      result: 'success',
    };
    await driver.saveAuditEvent(auditEvent);
  }

  return {
    status: 'success',
    data: outcome,
    errors: [],
    correlation_id: correlationId,
  };
}
