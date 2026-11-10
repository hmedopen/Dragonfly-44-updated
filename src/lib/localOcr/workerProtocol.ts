import type { ReadingConvention } from '../../types/scanning.ts';
import type {
  LocalOcrDiagnosticOptions,
  LocalOcrScanResult,
  ModelAssetPayload,
  OcrLanguageHint,
  OcrRouteId,
} from '../../types/localOcr.ts';

export interface WorkerLoadedModelKeys {
  detectorKey: string | null;
  ocrKey: string | null;
}

export type WorkerOcrRequest =
  | {
      type: 'run_page_ocr';
      jobId: string;
      pageId: string;
      imageBytes: ArrayBuffer;
      mimeType: string;
      languageHint: OcrLanguageHint;
      resolvedRoute: OcrRouteId;
      effectiveLanguage?: 'en' | 'ko' | 'ja' | 'zh';
      readingConvention: ReadingConvention;
      detectorModelKey?: string;
      ocrModelKey?: string;
      detectorAssets?: ModelAssetPayload;
      ocrAssets?: ModelAssetPayload;
      wasmPaths: string;
      diagnostics?: LocalOcrDiagnosticOptions;
    }
  | {
      type: 'cancel_job';
      jobId: string;
    }
  | {
      type: 'dispose';
    };

export type SerializableLocalOcrResult = Omit<LocalOcrScanResult, 'toCanonicalPageScanResult'>;

export type WorkerOcrResponse =
  | {
      type: 'job_result';
      jobId: string;
      result: SerializableLocalOcrResult;
      loadedModelKeys?: WorkerLoadedModelKeys;
    }
  | {
      type: 'job_cancelled';
      jobId: string;
      loadedModelKeys?: WorkerLoadedModelKeys;
    }
  | {
      type: 'job_error';
      jobId: string;
      error: string;
      loadedModelKeys?: WorkerLoadedModelKeys;
    }
  | {
      type: 'disposed';
    };
