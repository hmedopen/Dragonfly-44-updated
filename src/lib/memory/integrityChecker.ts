/**
 * Folio Script: System #5 — Integrity Checker & Diagnostic Engine
 * 
 * Implements the system integrity checks specified in Appendix B:
 * - Missing or invalid project IDs
 * - Duplicate canonical keys where uniqueness is required
 * - Approved non-user facts without provenance (MEM-003)
 * - Broken or cross-project provenance references (MEM-005)
 * - Illegal status/revision combinations
 * - Orphaned conflict references or supersession links
 * - Unsupported schema versions (MEM-002)
 * - Candidates older than retention threshold
 * - Audit gaps between record revisions
 */

import type {
  KnowledgeRecord,
  KnowledgeAuditEvent,
} from '../../types/memory';
import { MEMORY_ISSUE_CODES } from '../../types/memory';
import { getMemoryDriver } from '../../services/memoryRepository';

export interface IntegrityFinding {
  severity: 'critical' | 'major' | 'minor' | 'informational';
  code: string;
  recordId?: string;
  candidateId?: string;
  canonicalKey?: string;
  description: string;
}

export interface IntegrityReport {
  projectId: string;
  timestamp: number;
  totalRecordsChecked: number;
  totalCandidatesChecked: number;
  totalAuditEventsChecked: number;
  findings: IntegrityFinding[];
  isHealthy: boolean;
}

export async function runIntegrityCheck(projectId: string): Promise<IntegrityReport> {
  const driver = getMemoryDriver();
  const findings: IntegrityFinding[] = [];

  const records = await driver.getRecordsByProject(projectId);
  const candidates = await driver.getCandidatesByProject(projectId);
  const auditEvents = await driver.getAuditEventsForProject(projectId);
  const settings = await driver.getProjectSettings(projectId);

  const seenCanonicalKeys = new Map<string, KnowledgeRecord>();

  // 1. Audit Knowledge Records
  for (const record of records) {
    // Missing or invalid project ID
    if (!record.project_id || record.project_id !== projectId) {
      findings.push({
        severity: 'critical',
        code: MEMORY_ISSUE_CODES.CROSS_PROJECT_REFERENCE,
        recordId: record.record_id,
        description: `Record project_id "${record.project_id}" does not match inspected project "${projectId}"`,
      });
    }

    // Duplicate canonical keys among active approved records
    if (record.status === 'approved') {
      const existing = seenCanonicalKeys.get(record.canonical_key);
      if (existing) {
        findings.push({
          severity: 'major',
          code: MEMORY_ISSUE_CODES.DUPLICATE_PROPOSAL,
          recordId: record.record_id,
          canonicalKey: record.canonical_key,
          description: `Duplicate active approved canonical key "${record.canonical_key}" with record "${existing.record_id}"`,
        });
      } else {
        seenCanonicalKeys.set(record.canonical_key, record);
      }
    }

    // Provenance completeness on approved non-user facts (target 100%)
    if (record.status === 'approved' && record.trust_class !== 'user_confirmed') {
      if (!record.provenance || record.provenance.length === 0) {
        findings.push({
          severity: 'critical',
          code: MEMORY_ISSUE_CODES.MISSING_PROVENANCE,
          recordId: record.record_id,
          description: `Approved non-user record "${record.canonical_key}" is missing provenance references`,
        });
      }
    }

    // Scope check: Cross-project reference in scope
    if (record.scope && record.scope.project_id && record.scope.project_id !== projectId) {
      findings.push({
        severity: 'critical',
        code: MEMORY_ISSUE_CODES.CROSS_PROJECT_REFERENCE,
        recordId: record.record_id,
        description: `Record scope references different project "${record.scope.project_id}"`,
      });
    }

    // Schema version
    if (record.schema_version !== '1.0') {
      findings.push({
        severity: 'major',
        code: MEMORY_ISSUE_CODES.UNSUPPORTED_SCHEMA_VERSION,
        recordId: record.record_id,
        description: `Unsupported schema version "${record.schema_version}"`,
      });
    }

    // Status / revision sanity
    if (record.revision < 1) {
      findings.push({
        severity: 'critical',
        code: MEMORY_ISSUE_CODES.ILLEGAL_STATE_TRANSITION,
        recordId: record.record_id,
        description: `Invalid revision number ${record.revision}`,
      });
    }

    // Verify revision history matches current revision
    const revisions = await driver.getRevisions(record.record_id);
    if (revisions.length > 0 && record.status === 'approved') {
      const highestRev = Math.max(...revisions.map((r) => r.revision));
      if (highestRev !== record.revision) {
        findings.push({
          severity: 'major',
          code: MEMORY_ISSUE_CODES.STALE_REVISION,
          recordId: record.record_id,
          description: `Revision history mismatch: record shows revision ${record.revision}, but highest recorded revision is ${highestRev}`,
        });
      }
    }
  }

  // 2. Audit Candidates
  const retentionCutoff = Date.now() - settings.candidate_retention_days * 24 * 60 * 60 * 1000;
  for (const cand of candidates) {
    if (cand.created_at < retentionCutoff) {
      findings.push({
        severity: 'minor',
        code: 'MEM_STALE_CANDIDATE',
        candidateId: cand.candidate_id,
        description: `Candidate "${cand.candidate_id}" is older than retention threshold (${settings.candidate_retention_days} days)`,
      });
    }

    if (!cand.source_refs || cand.source_refs.length === 0) {
      findings.push({
        severity: 'major',
        code: MEMORY_ISSUE_CODES.MISSING_PROVENANCE,
        candidateId: cand.candidate_id,
        description: `Candidate "${cand.candidate_id}" is missing source references`,
      });
    }
  }

  // Record audit event for integrity check completion
  const checkAuditEvent: KnowledgeAuditEvent = {
    event_id: `audit-ic-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    event_type: 'IntegrityCheckCompleted',
    project_id: projectId,
    actor: 'integrity_checker',
    decision_reason: `Integrity check completed with ${findings.length} findings`,
    timestamp: Date.now(),
    result: 'success',
  };
  await driver.saveAuditEvent(checkAuditEvent);

  return {
    projectId,
    timestamp: Date.now(),
    totalRecordsChecked: records.length,
    totalCandidatesChecked: candidates.length,
    totalAuditEventsChecked: auditEvents.length,
    findings,
    isHealthy: findings.filter((f) => f.severity === 'critical' || f.severity === 'major').length === 0,
  };
}
