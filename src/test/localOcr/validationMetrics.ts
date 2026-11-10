import { calculateBoxIoU, computeBoxArea } from '../../lib/coordinateTransforms.ts';
import type { BubbleRegion, TextRegion } from '../../types/scanning.ts';

export interface GroundTruthTextRegion {
  id: string;
  readingOrder: number;
  box_2d: [number, number, number, number];
  text: string;
  lines: string[];
  hasBubble: boolean;
  mixedScript?: boolean;
  notes?: string;
}

export interface GroundTruthPageFixture {
  fixtureId: string;
  language: 'en' | 'ko' | 'ja' | 'zh';
  routeId: 'en_ppocrv6_small' | 'ko_ppocrv5_mobile' | 'ja_zh_ppocrv6_manga';
  readingConvention: 'ltr' | 'webtoon_v' | 'manga_rtl';
  localFileName: string;
  pngFileName: string;
  sourceUrl: string;
  svgSourceUrl?: string;
  sha256: string;
  width: number;
  height: number;
  license: string;
  attribution: string;
  isLongWebtoon?: boolean;
  regions: GroundTruthTextRegion[];
}

export function computeLevenshteinDistance<T>(a: readonly T[], b: readonly T[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

export function computeCharEditStats(predicted: string, reference: string): {
  edits: number;
  refChars: number;
  cer: number;
} {
  const predChars = Array.from(predicted);
  const refChars = Array.from(reference);
  const edits = computeLevenshteinDistance(predChars, refChars);
  return {
    edits,
    refChars: refChars.length,
    cer: refChars.length > 0 ? edits / refChars.length : edits > 0 ? 1 : 0,
  };
}

export function computeWordEditStats(predicted: string, reference: string): {
  edits: number;
  refWords: number;
  wer: number;
} {
  const tokenize = (s: string) =>
    s
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
  const predWords = tokenize(predicted);
  const refWords = tokenize(reference);
  const edits = computeLevenshteinDistance(predWords, refWords);
  return {
    edits,
    refWords: refWords.length,
    wer: refWords.length > 0 ? edits / refWords.length : edits > 0 ? 1 : 0,
  };
}

function computeContainment(
  inner: [number, number, number, number],
  outer: [number, number, number, number]
): number {
  const y1 = Math.max(inner[0], outer[0]);
  const x1 = Math.max(inner[1], outer[1]);
  const y2 = Math.min(inner[2], outer[2]);
  const x2 = Math.min(inner[3], outer[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const minArea = Math.max(1, Math.min(computeBoxArea(inner), computeBoxArea(outer)));
  return inter / minArea;
}

function normalizeLineText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface PageValidationMetrics {
  fixtureId: string;
  language: 'en' | 'ko' | 'ja' | 'zh';
  gtRegionCount: number;
  predRegionCount: number;
  matchedRegionCount: number;
  duplicateOverlapCount: number;
  unmatchedPredCount: number;
  detectionRecall: number;
  detectionPrecision: number;
  bubbleExpectedCount: number;
  bubbleMatchedCount: number;
  bubbleRecall: number | null;
  meanMatchedIoU: number;
  matchedCharEdits: number;
  matchedRefChars: number;
  matchedCer: number;
  endToEndCharEdits: number;
  totalRefChars: number;
  endToEndCer: number;
  matchedWordEdits: number | null;
  matchedRefWords: number | null;
  matchedWer: number | null;
  endToEndWordEdits: number | null;
  totalRefWords: number | null;
  endToEndWer: number | null;
  totalGtLines: number;
  verbatimExactLines: number;
  normalizedExactLines: number;
  multilineGtCount: number;
  multilineGroupedCount: number;
  readingOrderConcordantPairs: number;
  readingOrderTotalPairs: number;
  regionDetails: Array<{
    gtId: string;
    matchedPredId: string | null;
    iou: number;
    containment: number;
    expectedText: string;
    predictedText: string;
    cer: number;
    groupedCleanly: boolean | null;
    mixedScript: boolean;
  }>;
}

export function evaluatePagePredictions(
  fixture: GroundTruthPageFixture,
  predictedRegions: TextRegion[],
  predictedBubbles: BubbleRegion[]
): PageValidationMetrics {
  const gtRegions = fixture.regions;

  // Compute candidate match scores between all (gt, pred) pairs
  const candidates: Array<{
    gtIdx: number;
    predIdx: number;
    iou: number;
    containment: number;
    score: number;
  }> = [];

  for (let gi = 0; gi < gtRegions.length; gi++) {
    for (let pi = 0; pi < predictedRegions.length; pi++) {
      const iou = calculateBoxIoU(gtRegions[gi].box_2d, predictedRegions[pi].geometry.box_2d);
      const containment = computeContainment(
        gtRegions[gi].box_2d,
        predictedRegions[pi].geometry.box_2d
      );
      if (iou >= 0.25 || containment >= 0.6) {
        candidates.push({
          gtIdx: gi,
          predIdx: pi,
          iou,
          containment,
          score: iou * 0.7 + containment * 0.3,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const matchedGtToPred = new Map<number, { predIdx: number; iou: number; containment: number }>();
  const usedPreds = new Set<number>();

  for (const cand of candidates) {
    if (matchedGtToPred.has(cand.gtIdx) || usedPreds.has(cand.predIdx)) continue;
    matchedGtToPred.set(cand.gtIdx, {
      predIdx: cand.predIdx,
      iou: cand.iou,
      containment: cand.containment,
    });
    usedPreds.add(cand.predIdx);
  }

  // Count duplicate/fragmented predictions that overlap an already-matched GT region
  let duplicateOverlapCount = 0;
  for (let pi = 0; pi < predictedRegions.length; pi++) {
    if (usedPreds.has(pi)) continue;
    const overlapsMatchedGt = gtRegions.some(
      (gt, gi) =>
        matchedGtToPred.has(gi) &&
        (calculateBoxIoU(gt.box_2d, predictedRegions[pi].geometry.box_2d) >= 0.25 ||
          computeContainment(gt.box_2d, predictedRegions[pi].geometry.box_2d) >= 0.5)
    );
    if (overlapsMatchedGt) {
      duplicateOverlapCount++;
    }
  }

  // Bubble detection recall against GT regions inside speech bubbles
  const bubbleExpected = gtRegions.filter((r) => r.hasBubble);
  let bubbleMatchedCount = 0;
  for (const gt of bubbleExpected) {
    const hasBubbleHit = predictedBubbles.some(
      (b) =>
        calculateBoxIoU(gt.box_2d, b.geometry.box_2d) >= 0.2 ||
        computeContainment(gt.box_2d, b.geometry.box_2d) >= 0.6
    );
    if (hasBubbleHit) bubbleMatchedCount++;
  }

  const isSpaceWordLang = fixture.language === 'en' || fixture.language === 'ko';
  let matchedCharEdits = 0;
  let matchedRefChars = 0;
  let endToEndCharEdits = 0;
  let totalRefChars = 0;
  let matchedWordEdits = 0;
  let matchedRefWords = 0;
  let endToEndWordEdits = 0;
  let totalRefWords = 0;

  let totalGtLines = 0;
  let verbatimExactLines = 0;
  let normalizedExactLines = 0;
  let multilineGtCount = 0;
  let multilineGroupedCount = 0;

  const iouValues: number[] = [];
  const matchedOrderPairs: Array<{ gtOrder: number; predOrder: number }> = [];
  const regionDetails: PageValidationMetrics['regionDetails'] = [];

  for (let gi = 0; gi < gtRegions.length; gi++) {
    const gt = gtRegions[gi];
    totalGtLines += gt.lines.length;
    const match = matchedGtToPred.get(gi);
    const pred = match ? predictedRegions[match.predIdx] : null;
    const predText = pred ? pred.rawOCR : '';

    const cStats = computeCharEditStats(predText, gt.text);
    totalRefChars += cStats.refChars;
    endToEndCharEdits += cStats.edits;

    const wStats = isSpaceWordLang ? computeWordEditStats(predText, gt.text) : null;
    if (wStats) {
      totalRefWords += wStats.refWords;
      endToEndWordEdits += wStats.edits;
    }

    let groupedCleanly: boolean | null = null;
    if (gt.lines.length > 1) {
      multilineGtCount++;
      if (pred) {
        const predLinesCount = pred.lineSegments?.length ?? 0;
        const overlapsExtraSplit = predictedRegions.some(
          (other, pi) =>
            pi !== match!.predIdx &&
            computeContainment(other.geometry.box_2d, gt.box_2d) >= 0.6
        );
        groupedCleanly = predLinesCount >= 2 && !overlapsExtraSplit;
        if (groupedCleanly) multilineGroupedCount++;
      } else {
        groupedCleanly = false;
      }
    }

    if (match && pred) {
      iouValues.push(match.iou);
      matchedCharEdits += cStats.edits;
      matchedRefChars += cStats.refChars;
      if (wStats) {
        matchedWordEdits += wStats.edits;
        matchedRefWords += wStats.refWords;
      }
      matchedOrderPairs.push({
        gtOrder: gt.readingOrder,
        predOrder: pred.order.sequenceIndex,
      });

      const predLines = (pred.lineSegments || []).map((l) => l.text);
      for (const gtLine of gt.lines) {
        if (predLines.includes(gtLine)) verbatimExactLines++;
        if (predLines.some((pl) => normalizeLineText(pl) === normalizeLineText(gtLine))) {
          normalizedExactLines++;
        }
      }
    }

    regionDetails.push({
      gtId: gt.id,
      matchedPredId: pred ? pred.regionId : null,
      iou: match ? match.iou : 0,
      containment: match ? match.containment : 0,
      expectedText: gt.text,
      predictedText: predText,
      cer: cStats.cer,
      groupedCleanly,
      mixedScript: Boolean(gt.mixedScript),
    });
  }

  // Pairwise reading order concordance across matched GT regions
  let readingOrderConcordantPairs = 0;
  let readingOrderTotalPairs = 0;
  for (let i = 0; i < matchedOrderPairs.length; i++) {
    for (let j = i + 1; j < matchedOrderPairs.length; j++) {
      const a = matchedOrderPairs[i];
      const b = matchedOrderPairs[j];
      if (a.gtOrder === b.gtOrder) continue;
      readingOrderTotalPairs++;
      const gtSign = a.gtOrder < b.gtOrder;
      const predSign = a.predOrder < b.predOrder;
      if (gtSign === predSign) readingOrderConcordantPairs++;
    }
  }

  const matchedRegionCount = matchedGtToPred.size;
  return {
    fixtureId: fixture.fixtureId,
    language: fixture.language,
    gtRegionCount: gtRegions.length,
    predRegionCount: predictedRegions.length,
    matchedRegionCount,
    duplicateOverlapCount,
    unmatchedPredCount: Math.max(0, predictedRegions.length - matchedRegionCount),
    detectionRecall: gtRegions.length > 0 ? matchedRegionCount / gtRegions.length : 1,
    detectionPrecision:
      predictedRegions.length > 0 ? matchedRegionCount / predictedRegions.length : 0,
    bubbleExpectedCount: bubbleExpected.length,
    bubbleMatchedCount,
    bubbleRecall: bubbleExpected.length > 0 ? bubbleMatchedCount / bubbleExpected.length : null,
    meanMatchedIoU:
      iouValues.length > 0 ? iouValues.reduce((a, b) => a + b, 0) / iouValues.length : 0,
    matchedCharEdits,
    matchedRefChars,
    matchedCer: matchedRefChars > 0 ? matchedCharEdits / matchedRefChars : 0,
    endToEndCharEdits,
    totalRefChars,
    endToEndCer: totalRefChars > 0 ? endToEndCharEdits / totalRefChars : 0,
    matchedWordEdits: isSpaceWordLang ? matchedWordEdits : null,
    matchedRefWords: isSpaceWordLang ? matchedRefWords : null,
    matchedWer:
      isSpaceWordLang && matchedRefWords > 0
        ? matchedWordEdits / matchedRefWords
        : isSpaceWordLang
        ? 0
        : null,
    endToEndWordEdits: isSpaceWordLang ? endToEndWordEdits : null,
    totalRefWords: isSpaceWordLang ? totalRefWords : null,
    endToEndWer:
      isSpaceWordLang && totalRefWords > 0
        ? endToEndWordEdits / totalRefWords
        : isSpaceWordLang
        ? 0
        : null,
    totalGtLines,
    verbatimExactLines,
    normalizedExactLines,
    multilineGtCount,
    multilineGroupedCount,
    readingOrderConcordantPairs,
    readingOrderTotalPairs,
    regionDetails,
  };
}
