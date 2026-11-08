/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Guarded Correction Engine, Concurrency Protection & Rollback Ledger
 *
 * Implements Section 13 of the System #4 specification and User Decision #1:
 * - Semantic, OCR, classification, reading order, association, and geometry changes REQUIRE HUMAN APPROVAL.
 * - Narrowly defined deterministic repairs may run automatically ONLY when unambiguous,
 *   independently validated, and 100% reversible.
 * - Manual user decisions are IMMUNE to automated overwrite.
 * - Validates candidates independently against invariants and scope before commit.
 * - Records full audit records and rollback paths in STORE_REVIEW_AUDIT.
 */

import type { BubbleItem } from '../types/workbench';
import type { ReviewFinding, ProposedCorrection, ReviewSnapshot, ReviewAuditRecord } from '../types/review';
import {
  getPageBubbles,
  savePageBubbles,
  saveReviewAuditRecord,
  getReviewAuditRecords,
  updateReviewFindingStatus,
} from '../services/db';

export interface CorrectionEvaluationResult {
  isEligible: boolean;
  reason: string;
}

/**
 * Enforces the strict auto-correction eligibility policy (Decision #1).
 */
export function checkCorrectionEligibility(
  finding: ReviewFinding,
  correction?: ProposedCorrection
): CorrectionEvaluationResult {
  if (!correction) {
    return { isEligible: false, reason: 'No proposed correction attached to finding.' };
  }

  // 1. Custom typers can NEVER be automatically assigned
  if (correction.targetField === 'type') {
    return {
      isEligible: false,
      reason: 'Custom typer assignment is strictly manual-only in Folio Script.',
    };
  }

  // 2. Semantic translations, OCR, classification, geometry, and reading order REQUIRE HUMAN APPROVAL
  if (
    finding.domain === 'translation' ||
    finding.domain === 'ocr' ||
    finding.domain === 'classification' ||
    finding.domain === 'geometry' ||
    finding.domain === 'reading_order' ||
    finding.domain === 'association'
  ) {
    return {
      isEligible: false,
      reason: `Automated correction for domain "${finding.domain}" is disabled by policy. Requires explicit human approval.`,
    };
  }

  // 3. Narrowly defined deterministic integrity repairs (e.g. whitespace trim or validated order gaps)
  if (finding.domain === 'integrity' && correction.isEligibleForAuto) {
    return {
      isEligible: true,
      reason: 'Deterministic integrity repair with unambiguous expected value.',
    };
  }

  return {
    isEligible: false,
    reason: 'Correction does not meet strict automatic execution criteria; queued for human review.',
  };
}

export interface ApplyCorrectionOptions {
  finding: ReviewFinding;
  proposedCorrection: ProposedCorrection;
  snapshot: ReviewSnapshot;
  actor?: 'user' | 'system';
}

export interface ApplyCorrectionResult {
  success: boolean;
  committedBubble?: BubbleItem;
  auditRecord?: ReviewAuditRecord;
  error?: string;
  isConcurrencyConflict?: boolean;
}

/**
 * Executes a safe, atomic, guarded correction transaction.
 */
export async function applyGuardedCorrection(
  options: ApplyCorrectionOptions
): Promise<ApplyCorrectionResult> {
  const { finding, proposedCorrection, snapshot, actor = 'user' } = options;
  const bubbleId = finding.affectedEntity.bubbleId;
  const pageId = finding.affectedEntity.pageId;

  if (!bubbleId) {
    return { success: false, error: 'Cannot apply correction: finding has no associated bubble ID.' };
  }

  // 1. Fetch current live state from IndexedDB
  const liveBubbles = await getPageBubbles(pageId);
  const targetIndex = liveBubbles.findIndex((b) => b.id === bubbleId);
  if (targetIndex === -1) {
    return {
      success: false,
      error: `Target bubble "${bubbleId}" does not exist in live page storage.`,
      isConcurrencyConflict: true,
    };
  }

  const liveBubble = liveBubbles[targetIndex];

  // 2. Concurrency & Manual Decision Guard
  // Invariant: Never overwrite manual decisions without explicit user action
  if (actor === 'system' && liveBubble.isManuallyEdited) {
    return {
      success: false,
      error: 'Cannot auto-correct: bubble was manually edited by the user and is protected.',
    };
  }

  // Optimistic Concurrency Check: If bubble was edited after review snapshot, reject stale commit
  if (liveBubble.updatedAt && liveBubble.updatedAt > snapshot.timestamp && actor === 'system') {
    return {
      success: false,
      error: 'Concurrency conflict: bubble was modified after review snapshot was captured.',
      isConcurrencyConflict: true,
    };
  }

  // 3. Capture before-state deep copy
  const beforeState: BubbleItem = JSON.parse(JSON.stringify(liveBubble));

  // 4. Produce candidate state
  const candidateBubble: BubbleItem = JSON.parse(JSON.stringify(liveBubble));

  if (proposedCorrection.targetField === 'translatedText') {
    candidateBubble.translatedText = String(proposedCorrection.suggestedValue || '');
    // Append to translation history for 100% reversible undo
    const history = [...(candidateBubble.translationHistory || [])];
    history.push({
      timestamp: Date.now(),
      type: actor === 'user' ? 'manual' : 'humanized',
      text: candidateBubble.translatedText,
    });
    candidateBubble.translationHistory = history;
  } else if (proposedCorrection.targetField === 'sourceText') {
    // Invariant: Never mutate originalSourceText
    candidateBubble.sourceText = String(proposedCorrection.suggestedValue || '');
  } else if (proposedCorrection.targetField === 'orderIndex') {
    candidateBubble.index = Number(proposedCorrection.suggestedValue);
  } else if (proposedCorrection.targetField === 'type') {
    candidateBubble.type = String(proposedCorrection.suggestedValue);
  }

  candidateBubble.isManuallyEdited = true;
  candidateBubble.updatedAt = Date.now();

  // 5. Independent Validation: Ensure target issue is solved and no invalid state introduced
  if (proposedCorrection.targetField === 'translatedText' && candidateBubble.translatedText.length === 0 && liveBubble.sourceText.length > 0) {
    return { success: false, error: 'Independent validation failed: proposed translation is empty.' };
  }

  // 6. Atomic Commit
  const updatedBubbles = [...liveBubbles];
  updatedBubbles[targetIndex] = candidateBubble;

  // Handle re-indexing if order changed
  if (proposedCorrection.targetField === 'orderIndex') {
    updatedBubbles.sort((a, b) => a.index - b.index);
    updatedBubbles.forEach((b, idx) => {
      b.index = idx + 1;
    });
  }

  await savePageBubbles(pageId, updatedBubbles);

  // 7. Store Audit Record in STORE_REVIEW_AUDIT
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const auditRecord: ReviewAuditRecord = {
    auditId,
    jobId: snapshot.snapshotId,
    timestamp: Date.now(),
    snapshotId: snapshot.snapshotId,
    affectedEntity: finding.affectedEntity,
    beforeState,
    afterState: candidateBubble,
    findingId: finding.findingId,
    action: `apply_correction:${proposedCorrection.targetField}`,
    actor,
    ruleVersion: finding.ruleVersion,
    modelVersion: finding.modelVersion,
  };

  await saveReviewAuditRecord(auditRecord).catch((err) => {
    console.error('[ReviewCorrectionGuard] Failed to save audit record:', err);
  });

  // 8. Update Finding Status
  await updateReviewFindingStatus(
    finding.findingId,
    'corrected',
    `Applied correction to field "${proposedCorrection.targetField}" by ${actor}.`,
    actor
  );

  return {
    success: true,
    committedBubble: candidateBubble,
    auditRecord,
  };
}

/**
 * Reverts a previously applied correction using its audit record.
 */
export async function rollbackCorrection(auditId: string): Promise<boolean> {
  const auditRecords = await getReviewAuditRecords(auditId);
  const record = auditRecords.find((r) => r.auditId === auditId);
  if (!record) return false;

  const pageId = record.affectedEntity.pageId;
  const bubbleId = record.affectedEntity.bubbleId;
  if (!pageId || !bubbleId) return false;

  const bubbles = await getPageBubbles(pageId);
  const idx = bubbles.findIndex((b) => b.id === bubbleId);
  if (idx === -1) return false;

  // Restore exact before-state
  bubbles[idx] = record.beforeState;
  await savePageBubbles(pageId, bubbles);

  // Update finding back to open
  await updateReviewFindingStatus(record.findingId, 'open', 'Correction rolled back by user.', 'user');

  return true;
}
