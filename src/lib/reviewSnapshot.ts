/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Review Snapshot & Optimistic Concurrency Manager
 *
 * Captures immutable review snapshots prior to evaluation.
 * Computes deterministic content version hashes and verifies that
 * concurrent user edits do not cause silent data loss or stale commits.
 */

import type { BubbleItem } from '../types/workbench';
import type { PageScanResult } from '../types/scanning';
import type { ReviewSnapshot } from '../types/review';
import { getPageBubbles, getPageScan, saveReviewSnapshot } from '../services/db';

/**
 * Computes a fast deterministic string hash from an arbitrary object or string.
 */
export function computeContentHash(data: any): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) + hash) + json.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(16);
}

/**
 * Computes a version fingerprint for a collection of bubbles.
 * Accounts for text content, geometry, classification, ordering, and edit status.
 */
export function computeBubblesVersionHash(bubbles: BubbleItem[]): string {
  const fingerprint = bubbles.map((b) => ({
    id: b.id,
    index: b.index,
    box: b.box_2d,
    type: b.type,
    src: b.sourceText,
    trans: b.translatedText,
    manual: b.isManuallyEdited || false,
    updatedAt: b.updatedAt || 0,
  }));
  return computeContentHash(fingerprint);
}

export interface CaptureSnapshotOptions {
  pageId: string;
  chapterId?: string;
  activeInstructionsText?: string;
  existingBubbles?: BubbleItem[];
  existingScan?: PageScanResult | null;
}

/**
 * Captures an immutable ReviewSnapshot at review start.
 */
export async function captureReviewSnapshot(
  options: CaptureSnapshotOptions
): Promise<ReviewSnapshot> {
  const { pageId, chapterId, activeInstructionsText = '' } = options;

  // 1. Fetch bubbles & scan result if not provided
  const bubbles = options.existingBubbles || (await getPageBubbles(pageId));
  const scanResult = options.existingScan !== undefined ? options.existingScan : (await getPageScan(pageId));

  // 2. Clone bubbles deep to guarantee immutability
  const frozenBubbles: BubbleItem[] = JSON.parse(JSON.stringify(bubbles));

  // 3. Extract manual user decisions
  const manualDecisions: ReviewSnapshot['manualDecisions'] = [];
  for (const b of frozenBubbles) {
    if (b.isManuallyEdited) {
      manualDecisions.push({
        entityId: b.id,
        type: 'translatedText',
        value: b.translatedText,
        updatedAt: b.updatedAt || Date.now(),
      });
      if (b.type && b.type !== 'none') {
        manualDecisions.push({
          entityId: b.id,
          type: 'typer',
          value: b.type,
          updatedAt: b.updatedAt || Date.now(),
        });
      }
    }
  }

  const versionHash = computeBubblesVersionHash(frozenBubbles);
  const instructionsHash = computeContentHash(activeInstructionsText);
  const now = Date.now();
  const snapshotId = `revsnap-${pageId}-${now}-${Math.random().toString(36).substring(2, 7)}`;

  const snapshot: ReviewSnapshot = {
    snapshotId,
    pageId,
    chapterId,
    versionHash,
    timestamp: now,
    scanResult: scanResult ? JSON.parse(JSON.stringify(scanResult)) : null,
    bubbles: frozenBubbles,
    activeInstructionsHash: instructionsHash,
    manualDecisions,
  };

  // Persist snapshot to IndexedDB v6
  await saveReviewSnapshot(snapshot).catch((err) => {
    console.warn('[ReviewSnapshot] Could not save snapshot to IDB:', err);
  });

  return snapshot;
}

export interface ConcurrencyVerificationResult {
  isCurrent: boolean;
  staleEntityIds: string[];
  currentBubbles: BubbleItem[];
}

/**
 * Verifies that the review snapshot is not stale before committing any changes.
 * Isolates concurrency conflicts strictly to affected entities so that
 * an edit on bubble A does not prevent valid findings or repairs on bubble B.
 */
export async function verifySnapshotNotStale(
  snapshot: ReviewSnapshot
): Promise<ConcurrencyVerificationResult> {
  const currentBubbles = await getPageBubbles(snapshot.pageId);
  const currentMap = new Map(currentBubbles.map((b) => [b.id, b]));
  const staleEntityIds: string[] = [];

  for (const snapshotBubble of snapshot.bubbles) {
    const current = currentMap.get(snapshotBubble.id);
    if (!current) {
      // Bubble was deleted concurrently by the user!
      staleEntityIds.push(snapshotBubble.id);
      continue;
    }

    // Check if user edited text or box concurrently after snapshot was captured
    const textChanged = current.translatedText !== snapshotBubble.translatedText;
    const sourceChanged = current.sourceText !== snapshotBubble.sourceText;
    const typeChanged = current.type !== snapshotBubble.type;
    const boxChanged =
      current.box_2d[0] !== snapshotBubble.box_2d[0] ||
      current.box_2d[1] !== snapshotBubble.box_2d[1] ||
      current.box_2d[2] !== snapshotBubble.box_2d[2] ||
      current.box_2d[3] !== snapshotBubble.box_2d[3];

    const editedAfterSnapshot = (current.updatedAt || 0) > snapshot.timestamp;

    if (editedAfterSnapshot && (textChanged || sourceChanged || typeChanged || boxChanged)) {
      staleEntityIds.push(snapshotBubble.id);
    }
  }

  // Check if new bubbles were added concurrently
  for (const cur of currentBubbles) {
    if (!snapshot.bubbles.some((sb) => sb.id === cur.id)) {
      staleEntityIds.push(cur.id);
    }
  }

  return {
    isCurrent: staleEntityIds.length === 0,
    staleEntityIds,
    currentBubbles,
  };
}
