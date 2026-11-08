/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Canonical Data Contracts
 * 
 * Defines the core entities for page analysis, coordinate transforms,
 * text-bearing region detection, OCR, reading order, generic classification,
 * multidimensional confidence, and scan issue tracking.
 */

export type CoordinateSpace = 'original' | 'normalized_1000' | 'working' | 'crop';

export interface TransformRecord {
  transformId: string;
  sourceImageId: string;
  sourceWidth: number;
  sourceHeight: number;
  workingWidth: number;
  workingHeight: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  cropOriginX: number;
  cropOriginY: number;
  coordinateSpace: CoordinateSpace;
}

export interface RegionGeometry {
  coordinateSpace: CoordinateSpace;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  polygon?: Array<[number, number]>;
}

export interface PanelRegion {
  panelId: string;
  geometry: RegionGeometry;
  detectionConfidence: number;
  sequenceIndex: number;
}

export type GenericTextClass =
  | 'dialogue'
  | 'thought'
  | 'narration'
  | 'caption'
  | 'sfx'
  | 'vocalization'
  | 'environmental_text'
  | 'unknown';

export interface TextClassification {
  primaryClass: GenericTextClass;
  secondaryAttributes?: string[];
  confidence: number;
  needsReview: boolean;
  evidence?: string;
}

export interface ScanConfidence {
  imageQuality: number;
  regionDetection: number;
  ocr: number;
  association: number;
  readingOrder: number;
  classification: number;
}

export type ScanIssueFlag =
  | 'OCR_AMBIGUOUS'
  | 'REGION_BOUNDARY_UNCERTAIN'
  | 'BUBBLE_ASSOCIATION_AMBIGUOUS'
  | 'PANEL_ASSOCIATION_AMBIGUOUS'
  | 'READING_ORDER_CONFLICT'
  | 'CLASSIFICATION_AMBIGUOUS'
  | 'TEXT_CLIPPED'
  | 'DUPLICATE_CANDIDATE'
  | 'COORDINATE_TRANSFORM_ERROR'
  | 'STAGE_UNAVAILABLE';

export interface ScanIssue {
  issueId: string;
  flag: ScanIssueFlag;
  severity: 'blocker' | 'warning' | 'suggestion';
  affectedRegionIds: string[];
  reason: string;
  retryable: boolean;
  evidence?: string;
}

export interface RegionAssociations {
  bubbleId?: string | null;
  panelId?: string | null;
  speakerCandidate?: string | null;
  speakerConfidence?: number;
}

export interface RegionOrder {
  sequenceIndex: number;
  confidence: number;
  rationale?: string;
}

export interface TextRegion {
  regionId: string;
  geometry: RegionGeometry;
  rawOCR: string;
  normalizedText?: string;
  ocrAlternatives?: string[];
  confidence: ScanConfidence;
  classification: TextClassification;
  associations: RegionAssociations;
  order: RegionOrder;
  flags: ScanIssueFlag[];
  isManuallyEdited?: boolean;
  sourceLanguage?: string;
  isVertical?: boolean;
}

export type ReadingConvention = 'auto' | 'manga_rtl' | 'webtoon_v' | 'ltr';

export interface PageScanResult {
  scanId: string;
  pageId: string;
  sourceImageId: string;
  sourceDimensions: { width: number; height: number };
  readingConvention: ReadingConvention;
  status: 'complete' | 'partial' | 'failed';
  panels: PanelRegion[];
  regions: TextRegion[];
  issues: ScanIssue[];
  transformLedger: TransformRecord;
  visualContext?: string;
  detectedGlossaryTerms?: Array<{ source: string; arabic: string; category: string }>;
  detectedCharacters?: Array<{ nameOriginal: string; nameArabic: string; gender?: string; title?: string }>;
  detectedRelationships?: Array<{ speaker: string; addressee: string; tone: string; pronouns?: string }>;
  createdAt: number;
  version: number;
}
