/**
 * Folio Script: System #4 — Review & Quality Control Engine
 * Unified Review Orchestrator
 *
 * Implements Section 14 & Decision #3:
 * - Review All and Review Page use the exact same underlying evaluators,
 *   finding normalizer, severity rules, and correction safeguards.
 * - Supports targeted bubble review, selected bubbles review, single page review, and chapter review.
 * - Bounded concurrency (default 2 parallel pages) with failure isolation.
 * - Preserves partial results if a page fails.
 * - Synchronizes canonical findings to STORE_REVIEW_FINDINGS (IndexedDB v6)
 *   and adapts flags to workspace BubbleItem[] for UI compatibility.
 */

import type { EloquenceLevel, ProjectLoreLedger, ChapterIntelligence, BubbleItem } from '../types/workbench';
import type { ReviewFinding, ReviewJobResult, ReviewStrictness } from '../types/review';
import {
  savePageBubbles,
  saveReviewFindings,
  getPageBubbles,
  reviewFindingToReviewFlagItem,
} from '../services/db';
import { captureReviewSnapshot, verifySnapshotNotStale } from './reviewSnapshot';
import { runDeterministicIntegrityChecks } from './reviewIntegrity';
import { evaluateVisualAndScan } from './reviewScanEvaluator';
import { evaluateTranslationAndLinguistics } from './reviewTranslationEvaluator';
import { normalizeAndDeduplicateFindings } from './reviewNormalizer';
import { evaluateChapterContinuity } from './reviewChapterContinuity';
import { emitDiagnosticBoundary } from './diagnosticTap';

export interface PageTarget {
  pageId: string;
  pageIndex: number;
}

export interface ReviewOrchestratorOptions {
  scope: 'single_bubble' | 'selected_bubbles' | 'single_page' | 'chapter';
  chapterId?: string;
  pages: PageTarget[];
  targetBubbleId?: string;
  selectedBubbleIds?: string[];
  apiKey: string;
  selectedModel?: string;
  strictness?: ReviewStrictness;
  eloquenceLevel?: EloquenceLevel;
  includeSFX?: boolean;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
  onPageProgress?: (pageId: string, status: 'processing' | 'completed' | 'failed') => void;
}

/**
 * Reviews a single page through the canonical 5-stage evaluator pipeline.
 */
export async function evaluateSinglePagePipeline(
  page: PageTarget,
  options: ReviewOrchestratorOptions
): Promise<{ pageId: string; findings: ReviewFinding[]; summary: string; error?: string; isPartial?: boolean }> {
  const { pageId } = page;
  const {
    chapterId,
    apiKey,
    selectedModel,
    strictness = 'balanced',
    eloquenceLevel = 2,
    includeSFX = true,
    masterPromptOverride = '',
    isMasterPromptActive = true,
    projectLore,
    chapterIntelligence,
    targetBubbleId,
    selectedBubbleIds,
  } = options;

  try {
    // 1. Capture Immutable Review Snapshot
    const snapshot = await captureReviewSnapshot({
      pageId,
      chapterId,
      activeInstructionsText: masterPromptOverride,
    });

    // Filter snapshot bubbles if targeted or selected bubble scope
    if (targetBubbleId) {
      snapshot.bubbles = snapshot.bubbles.filter((b) => b.id === targetBubbleId);
    } else if (selectedBubbleIds && selectedBubbleIds.length > 0) {
      snapshot.bubbles = snapshot.bubbles.filter((b) => selectedBubbleIds.includes(b.id));
    }

    // 2. Deterministic Integrity Checks (Local zero-model-cost)
    const integrityFindings = runDeterministicIntegrityChecks(snapshot);

    // 3. Visual & Scan Evaluator (Artwork + Scan records)
    let visualFindings: ReviewFinding[] = [];
    const hasApiKey = Boolean(apiKey && apiKey.trim().length > 0);
    let isPartial = false;

    if (hasApiKey) {
      visualFindings = await evaluateVisualAndScan({
        snapshot,
        apiKey,
        selectedModel,
        includeSFX,
      });
    } else {
      isPartial = true;
    }

    // 4. Translation & Linguistic Evaluator (System #2 instructions + dialect protection)
    let translationFindings: ReviewFinding[] = [];
    if (hasApiKey) {
      translationFindings = await evaluateTranslationAndLinguistics({
        snapshot,
        apiKey,
        selectedModel,
        targetBubbleId,
        strictness,
        eloquenceLevel,
        masterPromptOverride,
        isMasterPromptActive,
        projectLore,
        chapterIntelligence,
      });
    } else {
      isPartial = true;
    }

    // 5. Normalization & Deduplication
    const allRawFindings = [...integrityFindings, ...visualFindings, ...translationFindings];
    const normalizedFindings = normalizeAndDeduplicateFindings(allRawFindings);

    // 6. Persist Canonical Findings to IndexedDB v6 (STORE_REVIEW_FINDINGS)
    await saveReviewFindings(normalizedFindings);

    // 7. Optimistic Concurrency Check & Workspace Adaptation
    const concurrency = await verifySnapshotNotStale(snapshot);
    const liveBubbles = concurrency.currentBubbles;

    // Group active findings by bubbleId
    const findingsByBubble = new Map<string, ReviewFinding[]>();
    for (const f of normalizedFindings) {
      const bId = f.affectedEntity.bubbleId;
      if (bId) {
        if (!findingsByBubble.has(bId)) {
          findingsByBubble.set(bId, []);
        }
        findingsByBubble.get(bId)!.push(f);
      }
    }

    // Adapt findings to BubbleItem.reviewFlags for UI compatibility
    const updatedBubbles = liveBubbles.map((bubble) => {
      // If targeting specific bubble(s), leave untouched bubbles intact
      if (targetBubbleId && bubble.id !== targetBubbleId) {
        return bubble;
      }
      if (selectedBubbleIds && selectedBubbleIds.length > 0 && !selectedBubbleIds.includes(bubble.id)) {
        return bubble;
      }

      // If bubble had a concurrency conflict (edited during review), keep user's live version
      if (concurrency.staleEntityIds.includes(bubble.id)) {
        return bubble;
      }

      const bubbleFindings = findingsByBubble.get(bubble.id) || [];
      const newFlags = bubbleFindings.map((f) => reviewFindingToReviewFlagItem(f));

      // Merge flags without duplicate categories
      const existingFlags = bubble.reviewFlags || [];
      const mergedFlags = [...existingFlags];
      for (const nf of newFlags) {
        if (!mergedFlags.some((ef) => ef.category === nf.category && ef.status !== 'dismissed')) {
          mergedFlags.push(nf);
        }
      }

      return {
        ...bubble,
        reviewFlags: mergedFlags,
        updatedAt: Date.now(),
      };
    });

    // Save updated bubbles to IDB
    await savePageBubbles(pageId, updatedBubbles);

    const summary = hasApiKey
      ? `Audited page ${page.pageIndex} (${snapshot.bubbles.length} dialogue units). Found ${normalizedFindings.length} findings.`
      : `Deterministic checks only for page ${page.pageIndex} (No Gemini API key provided; visual & linguistic stages skipped). Found ${normalizedFindings.length} findings.`;

    return {
      pageId,
      findings: normalizedFindings,
      summary,
      isPartial,
    };
  } catch (err: any) {
    console.error(`[ReviewOrchestrator] Error reviewing page ${pageId}:`, err);
    return {
      pageId,
      findings: [],
      summary: `Failed to review page ${page.pageIndex}: ${err?.message || String(err)}`,
      error: err?.message || String(err),
    };
  }
}

/**
 * Unified Review Orchestrator:
 * Executes Single Bubble, Selected Bubbles, Single Page, or Chapter-wide QC Review.
 */
export async function runReviewEngine(
  options: ReviewOrchestratorOptions
): Promise<ReviewJobResult> {
  const { scope, pages, strictness = 'balanced', apiKey, onPageProgress } = options;
  const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const reviewStart = Date.now();

  emitDiagnosticBoundary({
    subsystem: 'ai-services',
    component: 'ReviewOrchestrator',
    operation: `review:${scope}`,
    eventType: 'lifecycle',
    severity: 'info',
    status: 'running',
    correlationId: jobId,
    identifiers: { chapterId: options.chapterId, jobId },
    payload: { scope, pageCount: pages.length, strictness },
    explanation: `Started ${scope} QC review across ${pages.length} page(s) (${strictness} strictness).`,
  });

  const pageSummaries: Record<string, string> = {};
  const allFindings: ReviewFinding[] = [];
  const errors: string[] = [];

  let passedCount = 0;
  let flaggedCount = 0;
  let blockedCount = 0;
  let failedCount = 0;
  let hadPartial = !apiKey || apiKey.trim().length === 0;

  // Bounded concurrency pool: maximum 2 pages processed simultaneously
  const CONCURRENCY_LIMIT = 2;
  const pageQueue = [...pages];

  async function worker() {
    while (pageQueue.length > 0) {
      const page = pageQueue.shift();
      if (!page) break;

      onPageProgress?.(page.pageId, 'processing');
      const result = await evaluateSinglePagePipeline(page, options);

      pageSummaries[page.pageId] = result.summary;
      if (result.isPartial) {
        hadPartial = true;
      }
      if (result.error) {
        failedCount++;
        errors.push(result.error);
        onPageProgress?.(page.pageId, 'failed');
      } else {
        allFindings.push(...result.findings);
        if (result.findings.length === 0) {
          passedCount++;
        } else {
          flaggedCount += result.findings.length;
        }
        onPageProgress?.(page.pageId, 'completed');
      }
    }
  }

  // Run workers with bounded concurrency
  const workers = Array.from(
    { length: Math.min(CONCURRENCY_LIMIT, pages.length) },
    () => worker()
  );
  await Promise.all(workers);

  // Chapter-level Continuity Audit if scope === 'chapter' and multiple pages (F-11)
  let chapterSummary = `Completed QC audit across ${pages.length} pages.`;
  if (scope === 'chapter' && pages.length > 1) {
    try {
      const pagesWithBubbles: Array<{ pageId: string; pageIndex: number; bubbles: BubbleItem[] }> = [];
      for (const p of pages) {
        const bubbles = await getPageBubbles(p.pageId);
        pagesWithBubbles.push({ pageId: p.pageId, pageIndex: p.pageIndex, bubbles });
      }

      const continuityFindings = evaluateChapterContinuity({
        chapterId: options.chapterId || 'unknown-chapter',
        pages: pagesWithBubbles,
        strictness,
        projectLore: options.projectLore,
        chapterIntelligence: options.chapterIntelligence,
      });

      if (continuityFindings.length > 0) {
        allFindings.push(...continuityFindings);
        await saveReviewFindings(continuityFindings);
        flaggedCount += continuityFindings.length;
      }

      chapterSummary = `Chapter continuity & visual audit complete across ${pages.length} pages. Total findings: ${allFindings.length} (${continuityFindings.length} cross-page continuity findings).`;
    } catch (err: any) {
      console.warn('[ReviewOrchestrator] Chapter continuity stage error:', err);
      errors.push(`Chapter continuity evaluation warning: ${err?.message || String(err)}`);
    }
  }

  // Truthful status reporting (F-16)
  const overallStatus: 'completed' | 'partial' | 'failed' =
    failedCount === pages.length && pages.length > 0
      ? 'failed'
      : failedCount > 0 || hadPartial
      ? 'partial'
      : 'completed';

  emitDiagnosticBoundary({
    subsystem: 'ai-services',
    component: 'ReviewOrchestrator',
    operation: `review:${scope}`,
    eventType: 'lifecycle',
    severity: overallStatus === 'failed' ? 'error' : overallStatus === 'partial' ? 'warning' : 'healthy',
    status: overallStatus === 'failed' ? 'failed' : overallStatus === 'partial' ? 'degraded' : 'succeeded',
    durationMs: Date.now() - reviewStart,
    correlationId: jobId,
    identifiers: { chapterId: options.chapterId, jobId },
    payload: {
      overallStatus,
      findingsCount: allFindings.length,
      failedCount,
      passedCount,
    },
    explanation: `QC review (${scope}) finished with status "${overallStatus}", ${allFindings.length} finding(s), and ${failedCount} failed page(s).`,
  });

  return {
    jobId,
    scope: scope === 'selected_bubbles' ? 'single_bubble' : scope,
    status: overallStatus,
    strictness,
    pageSummaries,
    chapterSummary,
    findings: allFindings,
    counts: {
      passed: passedCount,
      flagged: flaggedCount,
      corrected: 0,
      blocked: blockedCount,
      failed: failedCount,
      skipped: hadPartial ? 1 : 0,
      notApplicable: 0,
    },
    snapshotId: jobId,
    errors: errors.length > 0 ? errors : undefined,
  };
}
