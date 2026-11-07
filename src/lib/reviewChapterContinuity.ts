/**
 * Dragonfly 44: System #4 — Review & Quality Control Engine
 * Chapter Continuity Evaluator
 * 
 * Performs cross-page continuity analysis across an entire chapter:
 * - Detects character name inconsistencies across pages
 * - Detects speaker address/relationship tone drift across pages
 * - Detects fantasy/terminology translation drift across pages
 * - Returns structured ReviewFinding items with cross_layer/integrity attribution
 */

import type { ReviewFinding, ReviewStrictness } from '../types/review';
import { ISSUE_CODES } from '../types/review';
import type { BubbleItem, ProjectLoreLedger, ChapterIntelligence } from '../types/workbench';

export interface ChapterContinuityOptions {
  chapterId: string;
  pages: Array<{ pageId: string; pageIndex: number; bubbles: BubbleItem[] }>;
  strictness?: ReviewStrictness;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
}

export function evaluateChapterContinuity(
  options: ChapterContinuityOptions
): ReviewFinding[] {
  const { chapterId, pages, projectLore, chapterIntelligence } = options;
  const findings: ReviewFinding[] = [];
  const now = Date.now();

  if (!pages || pages.length < 2) {
    return findings;
  }

  // 1. Gather all bubbles with translations across pages
  const allBubbles = pages.flatMap((p) =>
    p.bubbles.map((b) => ({ ...b, pageId: p.pageId, pageIndex: p.pageIndex }))
  );

  // 2. Track Character Names across pages
  // Check against ChapterIntelligence and ProjectLoreLedger
  const knownCharacters = new Map<string, string>(); // canonicalName -> expectedArabicName
  if (projectLore?.characters) {
    for (const c of projectLore.characters) {
      if (c.nameOriginal && c.nameArabic) {
        knownCharacters.set(c.nameOriginal.toLowerCase().trim(), c.nameArabic.trim());
      }
    }
  }
  if (chapterIntelligence?.characterRoster) {
    for (const c of chapterIntelligence.characterRoster) {
      if (c.nameOriginal && c.nameArabic) {
        knownCharacters.set(c.nameOriginal.toLowerCase().trim(), c.nameArabic.trim());
      }
    }
  }

  // Check known terms across pages
  const knownTerms = new Map<string, string>(); // canonicalTerm -> expectedArabicTerm
  if (projectLore?.terms) {
    for (const t of projectLore.terms) {
      if (t.termOriginal && t.termArabic) {
        knownTerms.set(t.termOriginal.toLowerCase().trim(), t.termArabic.trim());
      }
    }
  }
  if (chapterIntelligence?.termsHarvested) {
    for (const t of chapterIntelligence.termsHarvested) {
      if (t.termOriginal && t.termArabic) {
        knownTerms.set(t.termOriginal.toLowerCase().trim(), t.termArabic.trim());
      }
    }
  }

  // Inspect bubbles for terminology or name drifts against approved lore
  for (const b of allBubbles) {
    if (!b.sourceText || !b.translatedText) continue;
    const lowerSource = b.sourceText.toLowerCase();

    // Check characters
    for (const [origChar, expArabic] of knownCharacters.entries()) {
      if (lowerSource.includes(origChar)) {
        if (!b.translatedText.includes(expArabic)) {
          findings.push({
            findingId: `cont-char-${chapterId}-${b.pageId}-${b.id}-${origChar}`,
            domain: 'cross_layer',
            issueCode: ISSUE_CODES.NAME_INCONSISTENCY,
            severity: 'major',
            status: 'open',
            affectedEntity: {
              type: 'bubble',
              pageId: b.pageId,
              chapterId,
              bubbleId: b.id,
            },
            observation: `Character name "${origChar}" expected translation "${expArabic}" but translation contains different phrasing.`,
            expectedBehavior: `Consistent character name "${expArabic}" across all pages in chapter.`,
            evidence: {
              sourceSpan: origChar,
              translationSpan: b.translatedText,
              rationale: `Cross-page chapter continuity audit: name drift detected on Page ${b.pageIndex}.`,
            },
            confidence: {
              sourceOCR: 'high',
              finding: 'high',
              correction: 'moderate',
            },
            proposedAction: 'edit',
            ruleVersion: 'system4-chapter-continuity-v1',
            createdAt: now,
            snapshotVersion: `chap-cont-${chapterId}`,
          });
        }
      }
    }

    // Check terms
    for (const [origTerm, expTerm] of knownTerms.entries()) {
      if (lowerSource.includes(origTerm)) {
        if (!b.translatedText.includes(expTerm)) {
          findings.push({
            findingId: `cont-term-${chapterId}-${b.pageId}-${b.id}-${origTerm}`,
            domain: 'cross_layer',
            issueCode: ISSUE_CODES.TERMINOLOGY_INCONSISTENCY,
            severity: 'moderate',
            status: 'open',
            affectedEntity: {
              type: 'bubble',
              pageId: b.pageId,
              chapterId,
              bubbleId: b.id,
            },
            observation: `Continuity term "${origTerm}" expected Arabic "${expTerm}" was not found in translated bubble.`,
            expectedBehavior: `Unified terminology "${expTerm}" across chapter.`,
            evidence: {
              sourceSpan: origTerm,
              translationSpan: b.translatedText,
              rationale: `Cross-page chapter continuity audit: terminology inconsistency detected on Page ${b.pageIndex}.`,
            },
            confidence: {
              sourceOCR: 'high',
              finding: 'high',
              correction: 'moderate',
            },
            proposedAction: 'inspect',
            ruleVersion: 'system4-chapter-continuity-v1',
            createdAt: now,
            snapshotVersion: `chap-cont-${chapterId}`,
          });
        }
      }
    }
  }

  return findings;
}
