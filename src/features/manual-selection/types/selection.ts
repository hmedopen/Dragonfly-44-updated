export type SelectionMode = 'box' | 'bubble' | 'lasso';

export type ManualExtractionStatus =
  | 'created'
  | 'ocr_pending'
  | 'ocr_running'
  | 'ocr_success'
  | 'ocr_partial'
  | 'ocr_failed'
  | 'manual_text';

export type ManualTranslationStatus =
  | 'untranslated'
  | 'translating'
  | 'translated'
  | 'translation_failed';

export type OcrSupportedLanguage = 'en' | 'ja' | 'zh' | 'ko';

/**
 * Normalized 0-1000 bounding box [ymin, xmin, ymax, xmax] relative to original image dimensions.
 */
export type NormalizedBox2D = [number, number, number, number];

/**
 * Normalized 0-1000 polygon vertices [[x, y], ...] relative to original image dimensions.
 */
export type NormalizedPolygon = Array<[number, number]>;
