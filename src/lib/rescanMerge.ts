/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Non-Destructive Rescan & Multi-Signal Merge Engine
 * 
 * Enforces:
 * - Multi-signal matching (IoU + Centroid proximity + Text similarity + Spatial context)
 * - Zero loss of manual edits (isManuallyEdited = true)
 * - Zero loss of manually selected custom typers
 * - Zero loss of manual reading order sequences
 * - Zero loss of user-created manual bubbles
 */

import type { BubbleItem } from '../types/workbench';
import type { TextRegion, PageScanResult } from '../types/scanning';
import type { TyperSettings } from '../types/typers';
import { calculateBoxIoU, calculateCentroidDistance, computeBoxArea } from './coordinateTransforms';
import { defaultTyperForClass } from './scanAdapter';

/**
 * Calculates normalized string similarity using character-level Levenshtein distance.
 * Returns 0.0 (completely different) to 1.0 (identical).
 */
export function calculateTextSimilarity(strA: string, strB: string): number {
  if (!strA && !strB) return 1.0;
  if (!strA || !strB) return 0.0;

  const a = strA.trim().toLowerCase();
  const b = strB.trim().toLowerCase();
  if (a === b) return 1.0;

  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB);
  if (maxLen === 0) return 1.0;

  // Space-efficient Levenshtein distance
  const prevRow: number[] = new Array(lenB + 1);
  const currRow: number[] = new Array(lenB + 1);

  for (let j = 0; j <= lenB; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    currRow[0] = i;
    const charA = a.charCodeAt(i - 1);

    for (let j = 1; j <= lenB; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
    }

    for (let j = 0; j <= lenB; j++) {
      prevRow[j] = currRow[j];
    }
  }

  const distance = prevRow[lenB];
  return Math.max(0, 1.0 - distance / maxLen);
}

export interface MatchScoreDetails {
  iou: number;
  centroidDist: number;
  textSim: number;
  areaSim: number;
  totalScore: number;
}

/**
 * Evaluates match quality between an existing bubble and a newly detected text region.
 * Uses geometry (IoU), centroid proximity, text similarity, and spatial proportions.
 */
export function computeMatchScore(
  existing: BubbleItem,
  candidate: TextRegion
): MatchScoreDetails {
  const oldBox = existing.box_2d;
  const newBox = candidate.geometry.box_2d;

  // 1. Geometric IoU
  const iou = calculateBoxIoU(oldBox, newBox);

  // 2. Centroid proximity (0 to 1, max range 250 units in 0-1000 space)
  const dist = calculateCentroidDistance(oldBox, newBox);
  const centroidScore = Math.max(0, 1.0 - dist / 250);

  // 3. Text similarity (compare against existing sourceText and originalSourceText)
  const textSimSource = calculateTextSimilarity(existing.sourceText, candidate.rawOCR);
  const textSimOrig = existing.originalSourceText
    ? calculateTextSimilarity(existing.originalSourceText, candidate.rawOCR)
    : 0;
  const textSim = Math.max(textSimSource, textSimOrig);

  // 4. Area & aspect ratio similarity
  const areaOld = computeBoxArea(oldBox);
  const areaNew = computeBoxArea(newBox);
  const areaSim = areaOld > 0 && areaNew > 0
    ? Math.min(areaOld, areaNew) / Math.max(areaOld, areaNew)
    : 0;

  // Combined score weighted based on whether text is available
  const hasOldText = Boolean(existing.sourceText && existing.sourceText.trim().length > 0);
  const hasNewText = Boolean(candidate.rawOCR && candidate.rawOCR.trim().length > 0);

  let totalScore = 0;
  if (hasOldText && hasNewText) {
    totalScore = 0.35 * iou + 0.25 * centroidScore + 0.30 * textSim + 0.10 * areaSim;
  } else {
    // If no text yet (e.g. initial box or manual empty bubble), geometry rules
    totalScore = 0.55 * iou + 0.35 * centroidScore + 0.10 * areaSim;
  }

  return {
    iou,
    centroidDist: dist,
    textSim,
    areaSim,
    totalScore,
  };
}

export interface NonDestructiveMergeResult {
  mergedBubbles: BubbleItem[];
  updatedScanResult: PageScanResult;
  stats: {
    preservedManualEdits: number;
    preservedUserTypers: number;
    updatedExisting: number;
    newlyAdded: number;
    retainedUnmatchedManual: number;
  };
}

/**
 * Executes a non-destructive multi-signal rescan merge.
 */
export function mergeScanWithExistingState(options: {
  newScan: PageScanResult;
  existingBubbles: BubbleItem[];
  typerSettings: TyperSettings;
}): NonDestructiveMergeResult {
  const { newScan, existingBubbles, typerSettings } = options;

  const matchedExistingIds = new Set<string>();
  const matchedCandidateRegionIds = new Set<string>();

  const candidateRegions = [...newScan.regions];
  const oldBubbles = [...existingBubbles];

  const pairs: Array<{
    existing: BubbleItem;
    candidate: TextRegion;
    score: number;
  }> = [];

  // Compute all pairwise scores
  for (const existing of oldBubbles) {
    for (const candidate of candidateRegions) {
      const match = computeMatchScore(existing, candidate);
      // Qualification threshold: totalScore >= 0.40 OR IoU >= 0.45 OR (IoU >= 0.15 and textSim >= 0.65)
      const isQualified =
        match.totalScore >= 0.40 ||
        match.iou >= 0.45 ||
        (match.iou >= 0.15 && match.textSim >= 0.65);

      if (isQualified) {
        pairs.push({
          existing,
          candidate,
          score: match.totalScore,
        });
      }
    }
  }

  // Sort candidate pairs descending by score (greedy optimal matching)
  pairs.sort((a, b) => b.score - a.score);

  const matchedOldToNew = new Map<string, { existing: BubbleItem; candidate: TextRegion }>();

  for (const pair of pairs) {
    if (
      !matchedExistingIds.has(pair.existing.id) &&
      !matchedCandidateRegionIds.has(pair.candidate.regionId)
    ) {
      matchedExistingIds.add(pair.existing.id);
      matchedCandidateRegionIds.add(pair.candidate.regionId);
      matchedOldToNew.set(pair.existing.id, {
        existing: pair.existing,
        candidate: pair.candidate,
      });
    }
  }

  let preservedManualEdits = 0;
  let preservedUserTypers = 0;
  let updatedExisting = 0;
  let newlyAdded = 0;
  let retainedUnmatchedManual = 0;

  const finalBubbles: BubbleItem[] = [];
  const updatedRegions: TextRegion[] = [];

  // 1. Process matched bubbles
  for (const [oldId, pair] of matchedOldToNew) {
    const { existing, candidate } = pair;
    const isManuallyEdited = Boolean(existing.isManuallyEdited);

    // Typer preservation:
    // If user previously assigned or confirmed a typer, NEVER overwrite it!
    let effectiveType = existing.type;
    let effectivePrefix = existing.typerPrefix;

    const hadUserTyper = existing.type && existing.type !== 'none';
    if (isManuallyEdited || hadUserTyper) {
      preservedUserTypers++;
    } else {
      // Not user set: assign default for detected class
      const def = defaultTyperForClass(candidate.classification.primaryClass, typerSettings.typers);
      effectiveType = def.id;
      effectivePrefix = def.prefix;
    }

    // Source & Translation text preservation:
    let sourceText = candidate.rawOCR;
    let translatedText = existing.translatedText || '';
    let rawTranslatedText = existing.rawTranslatedText || '';
    let humanizedTranslatedText = existing.humanizedTranslatedText || '';
    let translationHistory = existing.translationHistory || [];

    if (isManuallyEdited) {
      preservedManualEdits++;
      // Preserve user's edited source text and translation
      sourceText = existing.sourceText !== undefined ? existing.sourceText : candidate.rawOCR;
    }

    // Geometry preservation:
    // If user explicitly created or moved this box, keep user's box
    const box_2d = isManuallyEdited ? existing.box_2d : candidate.geometry.box_2d;

    const mergedBubble: BubbleItem = {
      ...existing,
      id: oldId, // Retain stable identity
      pageId: newScan.pageId,
      box_2d,
      type: effectiveType,
      typerPrefix: effectivePrefix,
      sourceLanguage: candidate.sourceLanguage || existing.sourceLanguage || 'ja',
      sourceText,
      originalSourceText: candidate.rawOCR,
      translatedText,
      rawTranslatedText,
      humanizedTranslatedText,
      translationHistory,
      confidence: candidate.confidence?.ocr ?? existing.confidence ?? 0.9,
      isManuallyEdited,
      updatedAt: Date.now(),
    };

    finalBubbles.push(mergedBubble);
    updatedRegions.push({
      ...candidate,
      regionId: oldId,
      isManuallyEdited,
    });
    updatedExisting++;
  }

  // 2. Process unmatched existing bubbles (e.g. manual boxes drawn by user)
  for (const oldBubble of oldBubbles) {
    if (!matchedExistingIds.has(oldBubble.id)) {
      // INVARIANT: Never discard user-created or manually edited bubbles!
      retainedUnmatchedManual++;
      finalBubbles.push(oldBubble);

      updatedRegions.push({
        regionId: oldBubble.id,
        geometry: {
          coordinateSpace: 'normalized_1000',
          box_2d: oldBubble.box_2d,
        },
        rawOCR: oldBubble.sourceText || '',
        confidence: {
          imageQuality: 1.0,
          regionDetection: 1.0,
          ocr: 1.0,
          association: 1.0,
          readingOrder: 1.0,
          classification: 1.0,
        },
        classification: {
          primaryClass:
            oldBubble.type === 'sfx' || oldBubble.typerPrefix === 'SFX:'
              ? 'sfx'
              : 'dialogue',
          confidence: 1.0,
          needsReview: false,
        },
        sourceLanguage: oldBubble.sourceLanguage,
        associations: {},
        order: {
          sequenceIndex: oldBubble.index,
          confidence: 1.0,
          rationale: 'User manual annotation',
        },
        flags: [],
        isManuallyEdited:
          oldBubble.isManuallyEdited !== undefined ? oldBubble.isManuallyEdited : true,
      });
    }
  }

  // 3. Process unmatched newly detected regions (newly discovered bubbles)
  for (const candidate of candidateRegions) {
    if (!matchedCandidateRegionIds.has(candidate.regionId)) {
      newlyAdded++;
      const def = defaultTyperForClass(candidate.classification.primaryClass, typerSettings.typers);

      const newBubble: BubbleItem = {
        id: candidate.regionId,
        pageId: newScan.pageId,
        index: candidate.order.sequenceIndex || finalBubbles.length + 1,
        box_2d: candidate.geometry.box_2d,
        type: def.id,
        typerPrefix: def.prefix,
        sourceLanguage: candidate.sourceLanguage || 'ja',
        sourceText: candidate.rawOCR,
        originalSourceText: candidate.rawOCR,
        translatedText: '',
        rawTranslatedText: '',
        reviewFlags: [],
        confidence: candidate.confidence?.ocr ?? 0.9,
        isManuallyEdited: false,
        updatedAt: Date.now(),
      };

      finalBubbles.push(newBubble);
      updatedRegions.push(candidate);
    }
  }

  // 4. Stable ordering normalization
  // If the user had custom order, preserve relative order of existing items
  finalBubbles.sort((a, b) => a.index - b.index);
  finalBubbles.forEach((b, idx) => {
    b.index = idx + 1;
  });

  updatedRegions.sort((a, b) => a.order.sequenceIndex - b.order.sequenceIndex);
  updatedRegions.forEach((r, idx) => {
    r.order.sequenceIndex = idx + 1;
  });

  return {
    mergedBubbles: finalBubbles,
    updatedScanResult: {
      ...newScan,
      regions: updatedRegions,
    },
    stats: {
      preservedManualEdits,
      preservedUserTypers,
      updatedExisting,
      newlyAdded,
      retainedUnmatchedManual,
    },
  };
}
