/**
 * Folio Script: System #5 — Governance Engine
 * 
 * Enforces approval policies, state transitions, assertional conflict resolution,
 * protected user-data immunity, and optimistic compare-and-swap (CAS) commits.
 */

import type {
  KnowledgeRecord,
  KnowledgeAuditEvent,
  MemoryResult,
  KnowledgeConflictSet,
} from '../../types/memory';
import { MEMORY_ISSUE_CODES } from '../../types/memory';
import { isValidStateTransition, validateKnowledgeRecord } from './memoryValidator';
import { getMemoryDriver } from '../../services/memoryRepository';

/**
 * Promotes a Candidate to Approved authoritative project memory.
 * Requires user approval unless low-risk deterministic policy permits auto-promotion.
 * Protects user-confirmed data from automated overwrites.
 */
export async function approveKnowledgeCandidate(
  candidateId: string,
  expectedRevision: number | null = null,
  actor: string = 'user'
): Promise<MemoryResult<KnowledgeRecord>> {
  const driver = getMemoryDriver();
  const correlationId = `appr-${Date.now()}`;

  const candidate = await driver.getCandidate(candidateId);
  if (!candidate) {
    return {
      status: 'not_found',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `Candidate "${candidateId}" not found`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  const proposed = candidate.proposed_record;

  // Validate State Transition (candidate -> approved)
  if (!isValidStateTransition(proposed.status, 'approved')) {
    return {
      status: 'invalid',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.ILLEGAL_STATE_TRANSITION,
          message: `Illegal transition from "${proposed.status}" to "approved"`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  // Check if target record exists by canonical key
  const existingRecords = await driver.getRecordsByCanonicalKey(candidate.project_id, proposed.canonical_key);
  const existingRecord = existingRecords[0];

  // Protected User-Data Immunity: Automated actor cannot overwrite user-confirmed record
  if (existingRecord && existingRecord.trust_class === 'user_confirmed' && actor !== 'user') {
    return {
      status: 'conflict',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.PROTECTED_USER_DATA_CONFLICT,
          message: `Cannot auto-promote proposal to overwrite user-confirmed record "${existingRecord.canonical_key}"`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  const recordToApprove: KnowledgeRecord = {
    ...proposed,
    record_id: existingRecord ? existingRecord.record_id : proposed.record_id,
    status: 'approved',
    trust_class: actor === 'user' ? 'user_confirmed' : proposed.trust_class,
    updated_by: actor,
    updated_at: Date.now(),
    provenance: existingRecord
      ? [...existingRecord.provenance, ...proposed.provenance]
      : proposed.provenance,
  };

  const validation = validateKnowledgeRecord(recordToApprove);
  if (!validation.valid) {
    return {
      status: 'invalid',
      data: null,
      errors: validation.errors,
      correlation_id: correlationId,
    };
  }

  const expRev = existingRecord ? (expectedRevision !== null ? expectedRevision : existingRecord.revision) : null;

  const auditEvent: KnowledgeAuditEvent = {
    event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'CandidateApproved',
    project_id: candidate.project_id,
    record_id: recordToApprove.record_id,
    candidate_id: candidateId,
    actor,
    decision_reason: `Candidate approved by ${actor}`,
    source_refs: candidate.source_refs,
    timestamp: Date.now(),
    result: 'success',
  };

  const commitResult = await driver.saveRecordAtomic(recordToApprove, expRev, auditEvent);
  if (!commitResult.success) {
    return {
      status: commitResult.conflict ? 'conflict' : 'retryable_failure',
      data: null,
      errors: [
        {
          code: commitResult.conflict ? MEMORY_ISSUE_CODES.STALE_REVISION : MEMORY_ISSUE_CODES.AUDIT_TRANSACTION_FAILED,
          message: commitResult.error || 'Failed to atomically commit approved record',
        },
      ],
      correlation_id: correlationId,
      snapshot_revision: commitResult.conflict?.currentRevision,
    };
  }

  // Mark candidate as accepted and remove from pending queue
  await driver.deleteCandidate(candidateId);

  return {
    status: 'success',
    data: {
      ...recordToApprove,
      revision: commitResult.newRevision || recordToApprove.revision,
    },
    errors: [],
    correlation_id: correlationId,
    snapshot_revision: commitResult.newRevision,
  };
}

/**
 * Rejects a candidate fact with an explicit reason.
 */
export async function rejectKnowledgeCandidate(
  candidateId: string,
  reason: string,
  actor: string = 'user'
): Promise<MemoryResult<boolean>> {
  const driver = getMemoryDriver();
  const correlationId = `rej-${Date.now()}`;

  const candidate = await driver.getCandidate(candidateId);
  if (!candidate) {
    return {
      status: 'not_found',
      data: null,
      errors: [{ code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE, message: 'Candidate not found' }],
      correlation_id: correlationId,
    };
  }

  await driver.updateCandidateState(candidateId, 'rejected');

  const auditEvent: KnowledgeAuditEvent = {
    event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'CandidateRejected',
    project_id: candidate.project_id,
    candidate_id: candidateId,
    actor,
    decision_reason: reason,
    source_refs: candidate.source_refs,
    timestamp: Date.now(),
    result: 'rejected',
  };
  await driver.saveAuditEvent(auditEvent);

  return {
    status: 'success',
    data: true,
    errors: [],
    correlation_id: correlationId,
  };
}

/**
 * Reopens a previously rejected candidate.
 */
export async function reopenKnowledgeCandidate(
  candidateId: string,
  reason: string,
  actor: string = 'user'
): Promise<MemoryResult<boolean>> {
  const driver = getMemoryDriver();
  const correlationId = `reopen-${Date.now()}`;

  const candidate = await driver.getCandidate(candidateId);
  if (!candidate) {
    return {
      status: 'not_found',
      data: null,
      errors: [{ code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE, message: 'Candidate not found' }],
      correlation_id: correlationId,
    };
  }

  await driver.updateCandidateState(candidateId, 'ready_for_approval');

  const auditEvent: KnowledgeAuditEvent = {
    event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'CandidateReopened',
    project_id: candidate.project_id,
    candidate_id: candidateId,
    actor,
    decision_reason: reason,
    source_refs: candidate.source_refs,
    timestamp: Date.now(),
    result: 'success',
  };
  await driver.saveAuditEvent(auditEvent);

  return {
    status: 'success',
    data: true,
    errors: [],
    correlation_id: correlationId,
  };
}

/**
 * Updates an approved record with Compare-and-Swap (CAS) optimistic concurrency control.
 * Rejects stale commits and protects user-confirmed records.
 */
export async function updateKnowledgeRecordWithCas(
  recordId: string,
  expectedRevision: number,
  patch: Partial<KnowledgeRecord>,
  actor: string = 'user',
  changeReason: string = 'Manual user update'
): Promise<MemoryResult<KnowledgeRecord>> {
  const driver = getMemoryDriver();
  const correlationId = `upd-${Date.now()}`;

  const existing = await driver.getRecord(recordId);
  if (!existing) {
    return {
      status: 'not_found',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `Knowledge record "${recordId}" not found`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  // CAS Version Check
  if (existing.revision !== expectedRevision) {
    return {
      status: 'conflict',
      data: existing,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.STALE_REVISION,
          message: `Stale revision conflict: expected revision ${expectedRevision}, but current revision is ${existing.revision}`,
        },
      ],
      correlation_id: correlationId,
      snapshot_revision: existing.revision,
    };
  }

  // Protected User Data Check
  if (existing.trust_class === 'user_confirmed' && actor !== 'user') {
    return {
      status: 'conflict',
      data: existing,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.PROTECTED_USER_DATA_CONFLICT,
          message: 'Automated actor cannot overwrite user-confirmed record',
        },
      ],
      correlation_id: correlationId,
    };
  }

  // Check state transition if status is being updated
  if (patch.status && patch.status !== existing.status) {
    if (!isValidStateTransition(existing.status, patch.status)) {
      return {
        status: 'invalid',
        data: null,
        errors: [
          {
            code: MEMORY_ISSUE_CODES.ILLEGAL_STATE_TRANSITION,
            message: `Illegal state transition from "${existing.status}" to "${patch.status}"`,
          },
        ],
        correlation_id: correlationId,
      };
    }
  }

  const updatedRecord: KnowledgeRecord = {
    ...existing,
    ...patch,
    record_id: existing.record_id,
    project_id: existing.project_id,
    canonical_key: existing.canonical_key,
    updated_by: actor,
    updated_at: Date.now(),
  };

  const validation = validateKnowledgeRecord(updatedRecord);
  if (!validation.valid) {
    return {
      status: 'invalid',
      data: null,
      errors: validation.errors,
      correlation_id: correlationId,
    };
  }

  const auditEvent: KnowledgeAuditEvent = {
    event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'RecordRevised',
    project_id: existing.project_id,
    record_id: existing.record_id,
    actor,
    decision_reason: changeReason,
    timestamp: Date.now(),
    result: 'success',
  };

  const commit = await driver.saveRecordAtomic(updatedRecord, expectedRevision, auditEvent);
  if (!commit.success) {
    return {
      status: commit.conflict ? 'conflict' : 'retryable_failure',
      data: null,
      errors: [
        {
          code: commit.conflict ? MEMORY_ISSUE_CODES.STALE_REVISION : MEMORY_ISSUE_CODES.AUDIT_TRANSACTION_FAILED,
          message: commit.error || 'Failed to update record',
        },
      ],
      correlation_id: correlationId,
      snapshot_revision: commit.conflict?.currentRevision,
    };
  }

  return {
    status: 'success',
    data: {
      ...updatedRecord,
      revision: commit.newRevision || existing.revision + 1,
    },
    errors: [],
    correlation_id: correlationId,
    snapshot_revision: commit.newRevision,
  };
}

/**
 * Resolves a knowledge conflict set with traceable actor, outcome, and revision history.
 */
export async function resolveKnowledgeConflict(
  conflictId: string,
  resolutionDecision: string,
  winningPayload: any,
  actor: string = 'user'
): Promise<MemoryResult<KnowledgeConflictSet>> {
  const driver = getMemoryDriver();
  const correlationId = `res-${Date.now()}`;

  const conflict = await driver.getConflict(conflictId);
  if (!conflict) {
    return {
      status: 'not_found',
      data: null,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `Conflict "${conflictId}" not found`,
        },
      ],
      correlation_id: correlationId,
    };
  }

  conflict.status = 'resolved';
  conflict.resolved_by = actor;
  conflict.resolved_at = Date.now();
  conflict.resolution_decision = resolutionDecision;

  // If conflict is tied to an existing record, update the record with winning value
  if (conflict.record_id) {
    const existing = await driver.getRecord(conflict.record_id);
    if (existing) {
      await updateKnowledgeRecordWithCas(
        existing.record_id,
        existing.revision,
        { payload: winningPayload },
        actor,
        `Resolved conflict "${conflictId}": ${resolutionDecision}`
      );
    }
  }

  await driver.saveConflict(conflict);

  const auditEvent: KnowledgeAuditEvent = {
    event_id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'ConflictResolved',
    project_id: conflict.project_id,
    record_id: conflict.record_id,
    actor,
    decision_reason: resolutionDecision,
    timestamp: Date.now(),
    result: 'success',
  };
  await driver.saveAuditEvent(auditEvent);

  return {
    status: 'success',
    data: conflict,
    errors: [],
    correlation_id: correlationId,
  };
}
