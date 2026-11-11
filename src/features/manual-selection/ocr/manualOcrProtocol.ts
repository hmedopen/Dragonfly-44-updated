import type {
  ModelAssetPayload,
  OcrRouteId,
} from '../../../types/localOcr.ts';
import type {
  NormalizedBox2D,
  NormalizedPolygon,
  OcrSupportedLanguage,
} from '../types/selection.ts';

export interface ManualOcrCropTarget {
  regionId: string;
  kind: 'box' | 'bubble' | 'lasso';
  box_2d: NormalizedBox2D;
  polygon?: NormalizedPolygon;
}

export interface ManualOcrRegionOutcome {
  regionId: string;
  status: 'ocr_success' | 'ocr_partial' | 'ocr_failed';
  text: string;
  confidence: number;
  lineCount: number;
  error?: string;
}

export type WorkerManualOcrRequest =
  | {
      type: 'run_manual_crops';
      jobId: string;
      pageId: string;
      imageBytes: ArrayBuffer;
      mimeType: string;
      language: OcrSupportedLanguage;
      routeId: OcrRouteId;
      ocrModelKey: string;
      ocrAssets?: ModelAssetPayload;
      wasmPaths: string;
      targets: ManualOcrCropTarget[];
    }
  | {
      type: 'cancel_job';
      jobId: string;
    }
  | {
      type: 'dispose';
    };

export type WorkerManualOcrResponse =
  | {
      type: 'region_progress';
      jobId: string;
      regionId: string;
      completed: number;
      total: number;
    }
  | {
      type: 'job_result';
      jobId: string;
      pageId: string;
      sourceDimensions: { width: number; height: number };
      outcomes: ManualOcrRegionOutcome[];
      loadedOcrKey: string | null;
    }
  | {
      type: 'job_cancelled';
      jobId: string;
      loadedOcrKey: string | null;
    }
  | {
      type: 'job_error';
      jobId: string;
      error: string;
      loadedOcrKey: string | null;
    }
  | {
      type: 'disposed';
    };
