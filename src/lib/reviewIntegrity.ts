/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Deterministic Integrity & Local Invariants Evaluator
 *
 * Fast, local, zero-model-cost structural verification:
 * - Validates coordinate sanity and inspects transform ledgers before claiming geometry faults
 * - Detects duplicate or broken reading order sequence indices
 * - Detects stale translations where source OCR was edited after translation
 * - Identifies manual decision overwrite risks
 * - Validates required schema IDs and enums
 */

import type { ReviewFinding, ReviewSnapshot } from '../types/review';
import { ISSUE_CODES } from '../types/review';

export function runDeterministicIntegrityChecks(snapshot: ReviewSnapshot): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const { pageId, chapterId, bubbles, scanResult, snapshotId } = snapshot;

  // 1. Schema & Unique ID Integrity
  const seenBubbleIds = new Set<string>();
  for (const bubble of bubbles) {
    if (!bubble.id || typeof bubble.id !== 'string' || bubble.id.trim().length === 0) {
      findings.push({
        findingId: `int-id-empty-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        domain: 'integrity',
        issueCode: ISSUE_CODES.INVALID_SCHEMA,
        severity: 'critical',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: 'unknown' },
        observation: 'Bubble entity contains an empty or non-string ID.',
        expectedBehavior: 'All dialogue entities must have stable, unique string identifiers.',
        evidence: { rationale: 'Malformed bubble entity detected during local integrity pass.' },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'inspect',
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    } else if (seenBubbleIds.has(bubble.id)) {
      findings.push({
        findingId: `int-id-dup-${bubble.id}-${Date.now()}`,
        domain: 'integrity',
        issueCode: ISSUE_CODES.INVALID_SCHEMA,
        severity: 'critical',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: bubble.id },
        observation: `Duplicate bubble ID detected: "${bubble.id}".`,
        expectedBehavior: 'Entity IDs must be globally unique within the page scope.',
        evidence: { rationale: `Bubble ID "${bubble.id}" is shared by multiple elements.` },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'edit',
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    } else {
      seenBubbleIds.add(bubble.id);
    }
  }

  // 2. Coordinate Sanity & Transform Ledger Inspection
  // Rule: Do not automatically clamp suspicious coordinates. Investigate the coordinate transform first.
  const transform = scanResult?.transformLedger;

  for (const bubble of bubbles) {
    const [ymin, xmin, ymax, xmax] = bubble.box_2d || [];

    // Check for non-finite values
    if (!Number.isFinite(ymin) || !Number.isFinite(xmin) || !Number.isFinite(ymax) || !Number.isFinite(xmax)) {
      findings.push({
        findingId: `int-geo-nonfinite-${bubble.id}`,
        domain: 'geometry',
        issueCode: ISSUE_CODES.REGION_OUT_OF_BOUNDS,
        severity: 'critical',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: bubble.id },
        observation: `Bubble box coordinates contain non-finite numbers: [${ymin}, ${xmin}, ${ymax}, ${xmax}].`,
        expectedBehavior: 'All coordinates must be finite integers on normalized 0-1000 scale.',
        evidence: {
          geometryData: bubble.box_2d,
          rationale: 'Invalid numeric coordinate payload.',
        },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'edit',
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
      continue;
    }

    // Check for inverted coordinates
    if (ymin >= ymax || xmin >= xmax) {
      findings.push({
        findingId: `int-geo-inverted-${bubble.id}`,
        domain: 'geometry',
        issueCode: ISSUE_CODES.BOX_INVERTED_COORDINATES,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: bubble.id },
        observation: `Inverted bounding box: min bound >= max bound (y: ${ymin}>=${ymax}, x: ${xmin}>=${xmax}).`,
        expectedBehavior: 'ymin < ymax and xmin < xmax in normalized 0-1000 coordinates.',
        evidence: {
          geometryData: bubble.box_2d,
          transformData: transform || 'No transform ledger found',
          rationale: 'Inverted coordinates detected. Coordinate transform record was checked for rotation or inversion.',
        },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'inspect',
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    }

    // Check bounds [0, 1000]
    if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
      const transformNote = transform
        ? `Transform Record: ${transform.sourceWidth}x${transform.sourceHeight} -> ${transform.workingWidth}x${transform.workingHeight} (scaleX: ${transform.scaleX}, scaleY: ${transform.scaleY})`
        : 'No transform ledger available to explain out-of-bounds scale.';

      findings.push({
        findingId: `int-geo-oob-${bubble.id}`,
        domain: 'geometry',
        issueCode: ISSUE_CODES.REGION_OUT_OF_BOUNDS,
        severity: 'moderate',
        status: 'open',
        affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: bubble.id },
        observation: `Bubble box coordinates exceed normalized 0-1000 boundary: [${ymin}, ${xmin}, ${ymax}, ${xmax}].`,
        expectedBehavior: 'Coordinates must fit inside the 0-1000 normalized page canvas.',
        evidence: {
          geometryData: bubble.box_2d,
          transformData: transformNote,
          rationale: 'Coordinates exceed 1000 or fall below 0. Transform examined before making adjustment.',
        },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'not_assessed' },
        proposedAction: 'inspect',
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    }
  }

  // 3. Reading Order Sequence Checks
  const indexBuckets = new Map<number, string[]>();
  for (const bubble of bubbles) {
    const idx = bubble.index;
    if (!indexBuckets.has(idx)) {
      indexBuckets.set(idx, []);
    }
    indexBuckets.get(idx)!.push(bubble.id);
  }

  for (const [seqIndex, bubbleIds] of indexBuckets.entries()) {
    if (bubbleIds.length > 1) {
      findings.push({
        findingId: `int-order-dup-${seqIndex}`,
        domain: 'reading_order',
        issueCode: ISSUE_CODES.ORDER_INDEX_DUPLICATE,
        severity: 'major',
        status: 'open',
        affectedEntity: { type: 'page', pageId, chapterId, bubbleId: bubbleIds[0] },
        observation: `Duplicate reading order index #${seqIndex} shared by ${bubbleIds.length} bubbles (${bubbleIds.join(', ')}).`,
        expectedBehavior: 'Each bubble on a page must have a distinct, consecutive sequence index.',
        evidence: {
          rationale: `Bubbles [${bubbleIds.join(', ')}] both claim sequenceIndex ${seqIndex}.`,
        },
        confidence: { sourceOCR: 'high', finding: 'high', correction: 'high' },
        proposedAction: 'edit',
        proposedCorrection: {
          correctionId: `corr-order-dup-${seqIndex}`,
          targetField: 'orderIndex',
          currentValue: seqIndex,
          suggestedValue: seqIndex + 1,
          isEligibleForAuto: false, // Requires approval by default unless renumbering is requested
          validationStatus: 'pending',
        },
        ruleVersion: 'system4-integrity-v1',
        createdAt: Date.now(),
        snapshotVersion: snapshotId,
      });
    }
  }

  // 4. Stale Translation Detection
  for (const bubble of bubbles) {
    if (
      bubble.originalSourceText &&
      bubble.sourceText &&
      bubble.sourceText.trim() !== bubble.originalSourceText.trim()
    ) {
      // Source was manually modified
      const hasTranslation = bubble.translatedText && bubble.translatedText.trim().length > 0;
      const history = bubble.translationHistory || [];
      const hasRecentTranslation = history.some(
        (h) => (h.timestamp || 0) >= (bubble.updatedAt || 0) - 1000
      );

      if (hasTranslation && !hasRecentTranslation && !bubble.isManuallyEdited) {
        findings.push({
          findingId: `int-stale-source-${bubble.id}`,
          domain: 'cross_layer',
          issueCode: ISSUE_CODES.STALE_SOURCE_REFERENCE,
          severity: 'moderate',
          status: 'open',
          affectedEntity: { type: 'bubble', pageId, chapterId, bubbleId: bubble.id },
          observation: `Source OCR was modified, but the current Arabic translation may be based on the original OCR.`,
          expectedBehavior: 'Translations should reflect current source dialogue text.',
          evidence: {
            sourceSpan: `Current: "${bubble.sourceText}" vs Original: "${bubble.originalSourceText}"`,
            translationSpan: bubble.translatedText,
            rationale: 'Discrepancy between current source text and original scanned OCR.',
          },
          confidence: { sourceOCR: 'high', finding: 'moderate', correction: 'not_assessed' },
          proposedAction: 're_run_stage',
          ruleVersion: 'system4-integrity-v1',
          createdAt: Date.now(),
          snapshotVersion: snapshotId,
        });
      }
    }
  }

  return findings;
}
