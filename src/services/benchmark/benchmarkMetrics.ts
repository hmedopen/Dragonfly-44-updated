/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Metric Evaluators & Mathematical Scoring Algorithms
 * 
 * Computes deterministic, reproducible quality metrics across Systems #2–#6:
 * - Scanning: CER, WER, Detection IoU, Precision, Recall, Reading Order Accuracy
 * - Review: Precision, Recall, Severity Agreement, Unsafe Correction Count
 * - Translation: Completeness, Fidelity, Terminology Adherence, Dialect Protection
 * - Memory: Provenance Completeness, Conflict Recall, Lost-Update Rate
 * - Workspace: Alignment Drift, Round-Trip Invariant, Aspect Ratio Error, Hit-Test Accuracy
 */

import { calculateBoxIoU, verifyTransformRoundTrip, type CanonicalTransformParams } from '../../lib/workspace/geometryService';

/**
 * Levenshtein distance calculation.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Character Error Rate (CER) = Levenshtein(pred, ref) / max(1, ref.length)
 */
export function calculateCER(predicted: string, reference: string): number {
  const cleanPred = predicted.trim();
  const cleanRef = reference.trim();
  if (cleanRef.length === 0) {
    return cleanPred.length === 0 ? 0 : 1;
  }
  const dist = levenshteinDistance(cleanPred, cleanRef);
  return Math.min(1.0, dist / cleanRef.length);
}

/**
 * Word Error Rate (WER).
 */
export function calculateWER(predicted: string, reference: string): number {
  const predWords = predicted.trim().split(/\s+/).filter(Boolean);
  const refWords = reference.trim().split(/\s+/).filter(Boolean);
  if (refWords.length === 0) {
    return predWords.length === 0 ? 0 : 1;
  }

  const m = predWords.length;
  const n = refWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = predWords[i - 1] === refWords[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return Math.min(1.0, dp[m][n] / n);
}

/**
 * Detection Precision, Recall, and F1 at specified IoU threshold.
 */
export function evaluateDetectionBoxes(
  predictedBoxes: Array<[number, number, number, number]>,
  groundTruthBoxes: Array<[number, number, number, number]>,
  iouThreshold = 0.5
): { precision: number; recall: number; f1: number; avgIoU: number } {
  if (groundTruthBoxes.length === 0) {
    return {
      precision: predictedBoxes.length === 0 ? 1 : 0,
      recall: 1,
      f1: predictedBoxes.length === 0 ? 1 : 0,
      avgIoU: 1,
    };
  }

  if (predictedBoxes.length === 0) {
    return { precision: 0, recall: 0, f1: 0, avgIoU: 0 };
  }

  let truePositives = 0;
  let totalIoU = 0;
  const matchedGt = new Set<number>();

  for (const pred of predictedBoxes) {
    let bestIoU = 0;
    let bestGtIdx = -1;

    for (let i = 0; i < groundTruthBoxes.length; i++) {
      if (matchedGt.has(i)) continue;
      const iou = calculateBoxIoU(pred, groundTruthBoxes[i]);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestGtIdx = i;
      }
    }

    if (bestIoU >= iouThreshold && bestGtIdx >= 0) {
      truePositives++;
      matchedGt.add(bestGtIdx);
      totalIoU += bestIoU;
    }
  }

  const precision = truePositives / predictedBoxes.length;
  const recall = truePositives / groundTruthBoxes.length;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const avgIoU = truePositives > 0 ? totalIoU / truePositives : 0;

  return { precision, recall, f1, avgIoU };
}

/**
 * Reading-Order Pairwise Accuracy (Kendall tau concordant pairs).
 */
export function evaluateReadingOrderAccuracy(
  predictedIds: string[],
  groundTruthIds: string[]
): number {
  if (groundTruthIds.length <= 1) return 1.0;

  const gtPos = new Map<string, number>();
  groundTruthIds.forEach((id, idx) => gtPos.set(id, idx));

  const validPredIds = predictedIds.filter((id) => gtPos.has(id));
  if (validPredIds.length <= 1) return 0.0;

  let concordant = 0;
  let totalPairs = 0;

  for (let i = 0; i < validPredIds.length; i++) {
    for (let j = i + 1; j < validPredIds.length; j++) {
      totalPairs++;
      const idA = validPredIds[i];
      const idB = validPredIds[j];
      const gtA = gtPos.get(idA)!;
      const gtB = gtPos.get(idB)!;

      if ((i < j && gtA < gtB) || (i > j && gtA > gtB)) {
        concordant++;
      }
    }
  }

  return totalPairs > 0 ? concordant / totalPairs : 1.0;
}

/**
 * Review Engine Metric Evaluation: Precision, Recall, and Unsafe Correction Count.
 */
export function evaluateReviewMetrics(
  predictedFindings: Array<{ category: string; severity?: string; targetId?: string }>,
  expectedFindings: Array<{ category: string; severity?: string; targetId?: string }>,
  forbiddenCategories: string[] = []
): {
  precision: number;
  recall: number;
  f1: number;
  forbiddenViolationsCount: number;
} {
  let forbiddenViolations = 0;
  for (const pred of predictedFindings) {
    if (forbiddenCategories.includes(pred.category)) {
      forbiddenViolations++;
    }
  }

  if (expectedFindings.length === 0) {
    const isClean = predictedFindings.length === 0;
    return {
      precision: isClean ? 1 : 0,
      recall: 1,
      f1: isClean ? 1 : 0,
      forbiddenViolationsCount: forbiddenViolations,
    };
  }

  let matches = 0;
  const matchedExpected = new Set<number>();

  for (const pred of predictedFindings) {
    for (let i = 0; i < expectedFindings.length; i++) {
      if (matchedExpected.has(i)) continue;
      const exp = expectedFindings[i];
      if (exp.category === pred.category) {
        matches++;
        matchedExpected.add(i);
        break;
      }
    }
  }

  const precision = predictedFindings.length > 0 ? matches / predictedFindings.length : 0;
  const recall = expectedFindings.length > 0 ? matches / expectedFindings.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision,
    recall,
    f1,
    forbiddenViolationsCount: forbiddenViolations,
  };
}

/**
 * Workspace Transform Round-Trip & Aspect-Ratio Preservation Evaluation.
 */
export function evaluateWorkspaceGeometry(
  testPoints: Array<{ x: number; y: number }>,
  params: CanonicalTransformParams
): { maxDrift: number; allPassed: boolean; roundTripPassRate: number } {
  let maxDrift = 0;
  let passedCount = 0;

  for (const pt of testPoints) {
    const res = verifyTransformRoundTrip(pt, params, 0.5);
    if (res.drift > maxDrift) maxDrift = res.drift;
    if (res.pass) passedCount++;
  }

  const roundTripPassRate = testPoints.length > 0 ? passedCount / testPoints.length : 1.0;
  return {
    maxDrift,
    allPassed: passedCount === testPoints.length,
    roundTripPassRate,
  };
}
