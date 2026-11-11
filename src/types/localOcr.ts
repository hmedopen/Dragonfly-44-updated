import type {
  BubbleRegion,
  OcrLineSegment,
  PageScanResult,
  ReadingConvention,
  ScanIssueFlag,
  TextRegion,
} from './scanning.ts';

export type OcrLanguageHint = 'en' | 'ko' | 'ja' | 'zh' | 'auto';

export type OcrRouteId =
  | 'en_ppocrv6_small'
  | 'ja_zh_ppocrv6_manga'
  | 'ko_ppocrv5_mobile';

export type ModelRole = 'comic_detector' | 'ocr_pipeline';

export type RedistributionStatus =
  | 'dev_only_unverified_provenance'
  | 'dev_only_noncommercial_dataset'
  | 'approved_for_redistribution';

export interface ModelFileSpec {
  role: string;
  relativePath: string;
  upstreamRepo: string;
  revision: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface ModelManifestEntry {
  modelId: string;
  displayName: string;
  role: ModelRole;
  languagesOrTask: string[];
  upstreamRepositories: string[];
  pinnedRevisions: Record<string, string>;
  files: ModelFileSpec[];
  modelCardUrl: string;
  declaredLicense: string;
  trainingDataProvenanceNotes: string;
  redistributionStatus: RedistributionStatus;
  runtimeCompatibility: {
    sdkSupported: boolean;
    requiresCustomUstarArchive: boolean;
    requiresOrtAdapterFallback: boolean;
    executionProviders: Array<'wasm'>;
    notes: string;
  };
}

export type ModelInstallState =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'corrupt'
  | 'unsupported';

export interface ModelDistributionPolicy {
  developmentOnly: boolean;
  downloadPermitted: boolean;
  activationPermitted: boolean;
  redistributionApproved: boolean;
  commercialDistributionCleared: boolean;
  provenanceUnresolved: boolean;
  rejectionReason: string | null;
}

export interface ModelStatusInfo {
  modelId: string;
  state: ModelInstallState;
  installedRevision: string | null;
  verifiedBytes: number;
  expectedBytes: number;
  missingFiles: string[];
  corruptFiles: string[];
  error?: string;
  policy?: ModelDistributionPolicy;
}

export interface ModelDownloadProgress {
  modelId: string;
  currentFile: string;
  fileIndex: number;
  fileCount: number;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

export interface ModelAssetPayload {
  modelId: string;
  revisionLabel: string;
  files: Record<string, Uint8Array>;
}

export interface TileTransformRecord {
  tileId: string;
  row: number;
  col: number;
  originX: number;
  originY: number;
  cropWidth: number;
  cropHeight: number;
  inputWidth: number;
  inputHeight: number;
  scaleX: number;
  scaleY: number;
  padRight: number;
  padBottom: number;
  touchesPageLeft: boolean;
  touchesPageTop: boolean;
  touchesPageRight: boolean;
  touchesPageBottom: boolean;
}

export type ComicDetectorClass = 'bubble' | 'text_bubble' | 'text_free';

export interface RawComicDetection {
  detectionId: string;
  classLabel: ComicDetectorClass;
  classId: 0 | 1 | 2;
  /** Original page pixel coordinates [ymin, xmin, ymax, xmax] */
  pixelBox: [number, number, number, number];
  /** Normalized 0-1000 coordinates [ymin, xmin, ymax, xmax] */
  normalizedBox: [number, number, number, number];
  /** Raw model sigmoid confidence score (not calibrated probability) */
  rawScore: number;
  tileId: string;
  touchesTileInnerLeft: boolean;
  touchesTileInnerTop: boolean;
  touchesTileInnerRight: boolean;
  touchesTileInnerBottom: boolean;
}

export interface FusedComicRegion {
  id: string;
  classLabel: ComicDetectorClass;
  pixelBox: [number, number, number, number];
  normalizedBox: [number, number, number, number];
  rawScore: number;
  sourceTileIds: string[];
  boundaryUncertain: boolean;
  flags: ScanIssueFlag[];
}

export interface AssociatedTextCandidate {
  candidateId: string;
  kind: 'text_bubble' | 'text_free';
  pixelBox: [number, number, number, number];
  normalizedBox: [number, number, number, number];
  rawScore: number;
  sourceTileIds: string[];
  boundaryUncertain: boolean;
  flags: ScanIssueFlag[];
  associatedBubbleId: string | null;
  associationConfidence: number;
  candidateBubbleIds?: string[];
}

export interface RawOcrLineDetection {
  lineId: string;
  candidateId: string;
  text: string;
  /**
   * Uncalibrated aggregated line confidence (mean of selected CTC timestep probabilities in [0, 1]).
   * Not a statistically calibrated probability of correctness.
   */
  rawRecognitionScore: number;
  /** Mean of raw model output argmax scores prior to probability validation/softmax (when distinct). */
  rawModelScoreMean?: number;
  /** Per-character CTC timestep probabilities in [0, 1] before line-level aggregation. */
  tokenProbabilities?: number[];
  /** Indicates whether recognition confidence has undergone statistical calibration (always false in Phase 1.1). */
  confidenceCalibrated?: boolean;
  /** Raw text detector polygon score when available */
  rawDetectionScore?: number;
  /** Polygon in original page pixel coordinates [[x, y], ...] */
  pixelPolygon: Array<[number, number]>;
  /** Axis-aligned box in original page pixel coordinates [ymin, xmin, ymax, xmax] */
  pixelBox: [number, number, number, number];
  /** Axis-aligned box in normalized 0-1000 coordinates [ymin, xmin, ymax, xmax] */
  normalizedBox: [number, number, number, number];
  isVertical: boolean;
}

export interface LocalOcrPartialFailure {
  stage: 'tile_detection' | 'ocr_crop' | 'model_load';
  targetId: string;
  reason: string;
  recoverable: boolean;
}

export interface LocalOcrTimings {
  initMs: number;
  decodeMs: number;
  detectorMs: number;
  ocrMs: number;
  postprocessMs: number;
  totalMs: number;
  tileCount: number;
  cropCount: number;
  /** Measurable JS/WASM heap bytes delta or snapshot if exposed by runtime; null when unavailable */
  measuredMemoryBytes: number | null;
}

export interface LocalOcrModelUsage {
  detectorModelId: string;
  detectorRevision: string;
  ocrModelId: string;
  ocrRevision: string;
  routeId: OcrRouteId;
  ocrRuntimeUsed: 'paddleocr_js' | 'ort_web_adapter';
  executionProvider: 'wasm';
  simdEnabled: boolean;
  threadsUsed: number;
}

export interface LocalOcrDiagnosticOptions {
  includeTileDetails?: boolean;
  includeRawDetections?: boolean;
  detectorScoreThreshold?: number;
  ocrLineScoreThreshold?: number;
}

export interface LocalOcrImageInput {
  bytes: Uint8Array;
  mimeType: string;
}

export interface LocalOcrEngineOptions {
  image: Blob | LocalOcrImageInput;
  pageId: string;
  languageHint: OcrLanguageHint;
  /** Optional text/script evidence available prior to OCR for automatic language routing. */
  sampleText?: string;
  readingConvention?: ReadingConvention;
  correlationId?: string;
  signal?: AbortSignal;
  diagnostics?: LocalOcrDiagnosticOptions;
}

export interface LocalOcrScanResult {
  scanId: string;
  pageId: string;
  status: 'complete' | 'partial' | 'failed';
  sourceDimensions: { width: number; height: number };
  readingConvention: ReadingConvention;
  languageHint: OcrLanguageHint;
  resolvedRoute: OcrRouteId;
  bubbleRegions: BubbleRegion[];
  textRegions: TextRegion[];
  lineSegments: OcrLineSegment[];
  tiles: TileTransformRecord[];
  rawDetections?: RawComicDetection[];
  modelsUsed: LocalOcrModelUsage;
  timings: LocalOcrTimings;
  partialFailures: LocalOcrPartialFailure[];
  warnings: string[];
  error?: string;
  toCanonicalPageScanResult: () => PageScanResult;
}
