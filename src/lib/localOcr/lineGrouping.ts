import type { OcrLineSegment, ScanIssueFlag, TextRegion } from '../../types/scanning.ts';
import type { AssociatedTextCandidate, RawOcrLineDetection } from '../../types/localOcr.ts';
import {
  originalPixelsToNormalized1000,
  pixelPolygonToPixelBox,
} from './coordinateMapping.ts';
import { detectScriptSignal } from './languageRouter.ts';

export type LineJoinLanguage = 'en' | 'ko' | 'ja' | 'zh';

/**
 * Orders OCR lines within a single logical text candidate according to text orientation.
 * - Vertical CJK: columns ordered Right-to-Left, lines within a column Top-to-Bottom.
 * - Horizontal: rows ordered Top-to-Bottom, items on the same row Left-to-Right.
 */
export function orderOcrLines(
  lines: RawOcrLineDetection[],
  isVertical: boolean
): RawOcrLineDetection[] {
  if (lines.length <= 1) return [...lines];

  const sorted = [...lines];

  if (isVertical) {
    sorted.sort((a, b) => {
      const aCx = (a.pixelBox[1] + a.pixelBox[3]) / 2;
      const bCx = (b.pixelBox[1] + b.pixelBox[3]) / 2;
      const aW = Math.max(4, a.pixelBox[3] - a.pixelBox[1]);
      const bW = Math.max(4, b.pixelBox[3] - b.pixelBox[1]);
      const sameColTol = Math.max(aW, bW) * 0.6;
      if (Math.abs(aCx - bCx) > sameColTol) {
        // Right-to-left column order
        return bCx - aCx;
      }
      return a.pixelBox[0] - b.pixelBox[0];
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const aCy = (a.pixelBox[0] + a.pixelBox[2]) / 2;
    const bCy = (b.pixelBox[0] + b.pixelBox[2]) / 2;
    const aH = Math.max(4, a.pixelBox[2] - a.pixelBox[0]);
    const bH = Math.max(4, b.pixelBox[2] - b.pixelBox[0]);
    const sameRowTol = Math.max(aH, bH) * 0.5;
    if (Math.abs(aCy - bCy) > sameRowTol) {
      return aCy - bCy;
    }
    return a.pixelBox[1] - b.pixelBox[1];
  });
  return sorted;
}

const CJK_NO_SPACE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Script-aware line joining:
 * - English: preserves word spaces and joins trailing line-break hyphens between letters.
 * - Korean: ALWAYS preserves word spaces between wrapped Hangul lines.
 * - Japanese & Chinese: joins wrapped CJK lines without inserting unnecessary spaces.
 */
export function joinLinesByScript(
  rawLines: string[],
  language: LineJoinLanguage
): string {
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  let result = lines[0];

  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];

    if (language === 'en') {
      const endsWithWordHyphen = /[A-Za-z]-$/.test(result);
      const startsWithWordLetter = /^[A-Za-z]/.test(next);
      if (endsWithWordHyphen && startsWithWordLetter) {
        result = result.slice(0, -1) + next;
      } else {
        result += ' ' + next;
      }
      continue;
    }

    if (language === 'ko') {
      // Korean uses spaces between words (eojeol); never concatenate Hangul lines blindly
      result += ' ' + next;
      continue;
    }

    // Japanese or Chinese: check junction characters
    const prevLast = result.slice(-1);
    const nextFirst = next.charAt(0);
    const scriptHint = detectScriptSignal(result + next);

    if (scriptHint === 'hangul') {
      result += ' ' + next;
    } else if (CJK_NO_SPACE_CHAR.test(prevLast) || CJK_NO_SPACE_CHAR.test(nextFirst)) {
      result += next;
    } else if (/[A-Za-z0-9]$/.test(prevLast) && /^[A-Za-z0-9]/.test(nextFirst)) {
      result += ' ' + next;
    } else {
      result += next;
    }
  }

  return result;
}

export interface GroupLinesOptions {
  language: LineJoinLanguage;
  sourceWidth: number;
  sourceHeight: number;
  lowConfidenceThreshold?: number;
}

/**
 * Groups line-level OCR detections belonging to each text-bearing candidate
 * into one logical TextRegion per candidate (preserving lineSegments[]).
 * Preserves punctuation-only text and uncertain classifications without dropping.
 */
export function groupLinesToTextRegions(
  candidates: AssociatedTextCandidate[],
  linesByCandidate: Map<string, RawOcrLineDetection[]>,
  options: GroupLinesOptions
): { textRegions: TextRegion[]; allLineSegments: OcrLineSegment[] } {
  const {
    language,
    sourceWidth,
    sourceHeight,
    lowConfidenceThreshold = 0.65,
  } = options;

  const textRegions: TextRegion[] = [];
  const allLineSegments: OcrLineSegment[] = [];

  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    const rawLines = linesByCandidate.get(cand.candidateId) || [];

    const verticalVotes = rawLines.filter((l) => l.isVertical).length;
    const isVertical =
      rawLines.length > 0
        ? verticalVotes > rawLines.length / 2
        : (cand.pixelBox[2] - cand.pixelBox[0]) >
          (cand.pixelBox[3] - cand.pixelBox[1]) * 1.4 && (language === 'ja' || language === 'zh');

    const orderedLines = orderOcrLines(rawLines, isVertical);

    const lineSegments: OcrLineSegment[] = orderedLines.map((line) => {
      const seg: OcrLineSegment = {
        lineId: line.lineId,
        geometry: {
          coordinateSpace: 'normalized_1000',
          box_2d: line.normalizedBox,
          polygon: line.pixelPolygon.map(([px, py]) => [
            Math.max(0, Math.min(1000, Math.round((px / Math.max(1, sourceWidth)) * 1000))),
            Math.max(0, Math.min(1000, Math.round((py / Math.max(1, sourceHeight)) * 1000))),
          ]),
        },
        text: line.text,
        recognitionConfidence: line.rawRecognitionScore,
        detectionConfidence: line.rawDetectionScore,
        isVertical: line.isVertical,
      };
      allLineSegments.push(seg);
      return seg;
    });

    const joinedText = joinLinesByScript(
      orderedLines.map((l) => l.text),
      language
    );

    // Derive combined text geometry from OCR lines if available, else candidate text box
    let combinedNormBox = cand.normalizedBox;
    if (orderedLines.length > 0) {
      const allVertices = orderedLines.flatMap((l) => l.pixelPolygon);
      const pixelUnion = pixelPolygonToPixelBox(allVertices, sourceWidth, sourceHeight);
      combinedNormBox = originalPixelsToNormalized1000(pixelUnion, sourceWidth, sourceHeight, 1);
    }

    // Actual raw score aggregation (never synthetic 0.95)
    const rawOcrScore =
      orderedLines.length > 0
        ? orderedLines.reduce((sum, l) => sum + l.rawRecognitionScore, 0) / orderedLines.length
        : 0;

    const flags: ScanIssueFlag[] = [...cand.flags];
    if (orderedLines.length === 0 || joinedText.trim().length === 0) {
      if (!flags.includes('OCR_AMBIGUOUS')) {
        flags.push('OCR_AMBIGUOUS');
      }
    } else if (rawOcrScore < lowConfidenceThreshold && !flags.includes('OCR_AMBIGUOUS')) {
      flags.push('OCR_AMBIGUOUS');
    }

    const primaryClass = cand.kind === 'text_bubble' ? 'dialogue' : 'unknown';

    textRegions.push({
      regionId: cand.candidateId,
      geometry: {
        coordinateSpace: 'normalized_1000',
        box_2d: combinedNormBox,
      },
      rawOCR: joinedText,
      normalizedText: joinedText,
      lineSegments,
      confidence: {
        imageQuality: 1,
        regionDetection: cand.rawScore,
        ocr: rawOcrScore,
        association: cand.associationConfidence,
        readingOrder: 1,
        classification: cand.kind === 'text_bubble' ? cand.rawScore : 0.5,
      },
      classification: {
        primaryClass,
        confidence: cand.kind === 'text_bubble' ? cand.rawScore : 0.5,
        needsReview:
          flags.length > 0 ||
          cand.boundaryUncertain ||
          cand.kind === 'text_free',
        evidence:
          cand.kind === 'text_bubble'
            ? 'Detected inside speech bubble by comic geometry detector'
            : 'Detected outside speech bubble (text_free); functional class preserved as unknown pending review',
      },
      associations: {
        bubbleId: cand.associatedBubbleId,
      },
      order: {
        sequenceIndex: idx + 1,
        confidence: 1,
      },
      flags,
      sourceLanguage: language,
      isVertical,
      isManuallyEdited: false,
    });
  }

  return { textRegions, allLineSegments };
}
