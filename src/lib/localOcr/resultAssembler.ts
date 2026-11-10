import type {
  BubbleRegion,
  OcrLineSegment,
  PageScanResult,
  ReadingConvention,
  ScanIssue,
  TextRegion,
} from '../../types/scanning.ts';
import type {
  FusedComicRegion,
  LocalOcrModelUsage,
  LocalOcrPartialFailure,
  LocalOcrScanResult,
  LocalOcrTimings,
  OcrLanguageHint,
  OcrRouteId,
  RawComicDetection,
  TileTransformRecord,
} from '../../types/localOcr.ts';
import { createTransformRecord } from '../coordinateTransforms.ts';
import { inferHierarchicalReadingOrder, resolveReadingConvention } from '../readingOrder.ts';

export interface AssembleLocalScanInput {
  scanId: string;
  pageId: string;
  sourceWidth: number;
  sourceHeight: number;
  readingConvention?: ReadingConvention;
  languageHint: OcrLanguageHint;
  resolvedRoute: OcrRouteId;
  fusedBubbles: FusedComicRegion[];
  textRegions: TextRegion[];
  lineSegments: OcrLineSegment[];
  tiles: TileTransformRecord[];
  rawDetections?: RawComicDetection[];
  modelsUsed: LocalOcrModelUsage;
  timings: LocalOcrTimings;
  partialFailures: LocalOcrPartialFailure[];
  warnings: string[];
  status: 'complete' | 'partial' | 'failed';
  error?: string;
}

export function assembleLocalOcrScanResult(input: AssembleLocalScanInput): LocalOcrScanResult {
  const aspectRatio = input.sourceWidth > 0 ? input.sourceHeight / input.sourceWidth : 1.4;
  const effectiveConvention = resolveReadingConvention({
    readingConvention: input.readingConvention ?? 'auto',
    aspectRatio,
  });

  const bubbleRegions: BubbleRegion[] = input.fusedBubbles.map((b) => ({
    bubbleId: b.id,
    geometry: {
      coordinateSpace: 'normalized_1000',
      box_2d: b.normalizedBox,
    },
    detectionConfidence: b.rawScore,
    tileOriginIds: b.sourceTileIds,
    boundaryUncertain: b.boundaryUncertain,
    flags: b.flags,
  }));

  const orderedTextRegions =
    input.textRegions.length > 0
      ? inferHierarchicalReadingOrder([], input.textRegions, effectiveConvention)
      : [];

  const toCanonicalPageScanResult = (): PageScanResult => {
    const transformLedger = createTransformRecord({
      sourceImageId: input.pageId,
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
    });

    const issues: ScanIssue[] = [];
    for (const region of orderedTextRegions) {
      for (const flag of region.flags) {
        issues.push({
          issueId: `local-issue-${region.regionId}-${flag}`,
          flag,
          severity: flag === 'OCR_AMBIGUOUS' ? 'warning' : 'suggestion',
          affectedRegionIds: [region.regionId],
          reason:
            flag === 'OCR_AMBIGUOUS'
              ? 'Local OCR recognition confidence is below threshold or text is empty.'
              : flag === 'REGION_BOUNDARY_UNCERTAIN'
              ? 'Detection touches an internal tile boundary and could not be cleanly merged.'
              : flag === 'BUBBLE_ASSOCIATION_AMBIGUOUS'
              ? 'Text-to-bubble geometric association is ambiguous.'
              : 'Local OCR region requires review.',
          retryable: true,
        });
      }
    }

    for (const failure of input.partialFailures) {
      issues.push({
        issueId: `local-failure-${failure.stage}-${failure.targetId}`,
        flag: 'STAGE_UNAVAILABLE',
        severity: 'warning',
        affectedRegionIds: [],
        reason: `${failure.stage} (${failure.targetId}): ${failure.reason}`,
        retryable: failure.recoverable,
      });
    }

    return {
      scanId: input.scanId,
      pageId: input.pageId,
      sourceImageId: input.pageId,
      sourceDimensions: {
        width: input.sourceWidth,
        height: input.sourceHeight,
      },
      readingConvention: effectiveConvention,
      status: input.status,
      panels: [],
      bubbleRegions,
      regions: orderedTextRegions,
      issues,
      transformLedger,
      createdAt: Date.now(),
      version: 1,
    };
  };

  return {
    scanId: input.scanId,
    pageId: input.pageId,
    status: input.status,
    sourceDimensions: {
      width: input.sourceWidth,
      height: input.sourceHeight,
    },
    readingConvention: effectiveConvention,
    languageHint: input.languageHint,
    resolvedRoute: input.resolvedRoute,
    bubbleRegions,
    textRegions: orderedTextRegions,
    lineSegments: input.lineSegments,
    tiles: input.tiles,
    rawDetections: input.rawDetections,
    modelsUsed: input.modelsUsed,
    timings: input.timings,
    partialFailures: input.partialFailures,
    warnings: input.warnings,
    error: input.error,
    toCanonicalPageScanResult,
  };
}
