/**
 * Folio Script: System #3 — Manga Scanning & Classification Engine
 * Canonical Page Scanner
 * 
 * Implements the System #3 Page Scan Algorithm:
 * 1. Image preparation & transform ledger mapping
 * 2. Visual page & panel candidate detection
 * 3. Text-bearing region detection
 * 4. Verbatim OCR candidate generation with ambiguity flagging
 * 5. Hierarchical reading-order inference (Manga RTL, Webtoon, LTR)
 * 6. Evidence-based generic functional classification
 * 7. Multidimensional confidence calibration
 * 8. Targeted crop retries for ambiguous regions (bounded)
 * 9. Assembly of canonical PageScanResult
 */

import { getPageBlob } from '../services/db';
import { extractImageDimensions } from '../services/fileIngestion';
import { createTransformRecord } from './coordinateTransforms';
import { resolveReadingConvention, inferHierarchicalReadingOrder } from './readingOrder';
import { buildSystem3ScanInstruction } from './scanPromptBuilder';
import { validateSystem3ScanOutput } from './translationValidator';
import { performTargetedCropRetries } from './cropRetry';
import type {
  PageScanResult,
  PanelRegion,
  TextRegion,
  ReadingConvention,
  ScanIssue,
  ScanIssueFlag,
  GenericTextClass,
} from '../types/scanning';
import { blobToBase64 } from './geminiScan';

export interface ScanMangaPageOptions {
  pageId: string;
  apiKey: string;
  selectedModel?: string;
  readingConvention?: ReadingConvention;
  includeSFX?: boolean;
  enableTargetedRetries?: boolean;
  maxRetries?: number;
  ocrConfidenceThreshold?: number;
  signal?: AbortSignal;
}

export async function scanMangaPage(options: ScanMangaPageOptions): Promise<PageScanResult> {
  const {
    pageId,
    apiKey,
    selectedModel = 'gemini-3.8-flash',
    readingConvention = 'auto',
    includeSFX = true,
    enableTargetedRetries = true,
    maxRetries = 3,
    ocrConfidenceThreshold = 0.65,
    signal,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Retrieve page image blob
  const blob = await getPageBlob(pageId);
  if (!blob) {
    throw new Error(`Page image blob not found in IndexedDB for ID: ${pageId}`);
  }

  // 2. Extract image dimensions & create Transform Record
  const dimensions = await extractImageDimensions(blob);
  const transformLedger = createTransformRecord({
    sourceImageId: pageId,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
  });

  const aspectRatio = dimensions.width > 0 ? dimensions.height / dimensions.width : 1.4;
  const effectiveConvention = resolveReadingConvention({
    readingConvention,
    aspectRatio,
  });

  // 3. Assemble System #3 Multimodal Prompt
  const systemInstruction = buildSystem3ScanInstruction({
    readingConvention: effectiveConvention,
    includeSFX,
  });

  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Analyze this comic page. Detect panels, speech bubbles, sound effects, and floating text with normalized bounding boxes [0-1000]. Transcribe verbatim source text and classify into generic functional categories in pure JSON.',
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.15,
    },
  };

  // 4. Dispatch Gemini API Call
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  // 5. Local Structural Validation
  const validated = validateSystem3ScanOutput(rawText || '');
  if (!validated.isValid || !validated.data) {
    throw new Error(validated.errors[0] || 'Failed to parse structured JSON from Gemini response.');
  }

  const {
    pageContext,
    panels: rawPanels,
    regions: rawRegions,
    detectedCharacters,
    detectedGlossaryTerms,
    detectedRelationships,
  } = validated.data;

  // 6. Build PanelRegion entities
  const panels: PanelRegion[] = rawPanels.map((p, idx) => ({
    panelId: p.panelId || `panel-${idx + 1}`,
    geometry: {
      coordinateSpace: 'normalized_1000',
      box_2d: p.box_2d,
    },
    detectionConfidence: 0.95,
    sequenceIndex: idx + 1,
  }));

  const issues: ScanIssue[] = [];

  // 7. Build TextRegion entities with Multidimensional Confidence
  let textRegions: TextRegion[] = rawRegions.map((r, idx) => {
    const flags: ScanIssueFlag[] = [];
    if (r.isAmbiguous) flags.push('OCR_AMBIGUOUS');
    if (r.isClipped) flags.push('TEXT_CLIPPED');

    // Estimate heuristic confidence with evidence dimensions (F-25)
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    const boxArea = Math.abs((ymax - ymin) * (xmax - xmin)) / 1_000_000;
    const hasPlausibleSize = boxArea > 0.002 && boxArea < 0.35;
    const regionDetectionConfidence = hasPlausibleSize ? 0.92 : 0.75;
    const readingOrderConfidence = 0.90;
    if (ymin <= 5 || xmin <= 5 || ymax >= 995 || xmax >= 995) {
      flags.push('REGION_BOUNDARY_UNCERTAIN');
    }

    // Image quality dimension
    const isHighRes = dimensions.width >= 1000 && dimensions.height >= 1400;
    const imageQualityConfidence = isHighRes ? 0.98 : 0.80;

    // OCR confidence calibration
    let ocrConfidence = 0.95;
    if (r.isAmbiguous) ocrConfidence = 0.65;
    if (r.isClipped) ocrConfidence = Math.min(ocrConfidence, 0.70);
    if (!r.rawOCR || r.rawOCR.trim().length === 0) ocrConfidence = 0.50;

    // Apply configured OCR confidence threshold for ambiguity flag
    if (ocrConfidence < ocrConfidenceThreshold && !flags.includes('OCR_AMBIGUOUS')) {
      flags.push('OCR_AMBIGUOUS');
    }

    // Classification confidence
    const classificationConfidence = r.primaryClass === 'unknown' ? 0.50 : 0.90;

    return {
      regionId: r.regionId || `r-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      geometry: {
        coordinateSpace: 'normalized_1000',
        box_2d: r.box_2d,
      },
      rawOCR: r.rawOCR,
      ocrAlternatives: r.ocrAlternatives,
      confidence: {
        imageQuality: imageQualityConfidence,
        regionDetection: regionDetectionConfidence,
        ocr: ocrConfidence,
        association: 0.90,
        readingOrder: readingOrderConfidence,
        classification: classificationConfidence,
      },
      classification: {
        primaryClass: r.primaryClass as GenericTextClass,
        confidence: classificationConfidence,
        needsReview: Boolean(r.primaryClass === 'unknown' || r.isAmbiguous),
        evidence: r.visualEvidence,
      },
      associations: {
        speakerCandidate: r.speakerCandidate,
      },
      order: {
        sequenceIndex: idx + 1,
        confidence: 0.90,
      },
      flags,
      isVertical: r.isVertical,
      isManuallyEdited: false,
    };
  });

  // 8. Hierarchical Reading Order Inference
  textRegions = inferHierarchicalReadingOrder(panels, textRegions, effectiveConvention);

  // 9. Targeted Crop Retries for Ambiguous Regions (Bounded)
  if (enableTargetedRetries && textRegions.some((r) => r.flags.length > 0)) {
    try {
      const retryResult = await performTargetedCropRetries({
        blob,
        regions: textRegions,
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        apiKey,
        selectedModel,
        maxRetries,
        signal,
      });
      textRegions = retryResult.updatedRegions;
    } catch (e) {
      console.warn('[MangaScanner] Targeted crop retries experienced a non-fatal error:', e);
    }
  }

  // 10. Generate ScanIssues for Workspace Review
  for (const r of textRegions) {
    for (const flag of r.flags) {
      issues.push({
        issueId: `issue-${r.regionId}-${flag}`,
        flag,
        severity: flag === 'OCR_AMBIGUOUS' ? 'warning' : 'suggestion',
        affectedRegionIds: [r.regionId],
        reason:
          flag === 'OCR_AMBIGUOUS'
            ? 'احتمالية غموض في قراءة الحروف بالرسم الأصلي'
            : flag === 'TEXT_CLIPPED'
            ? 'نص مقطوع جزئياً عند حافة الإطار'
            : 'تحديد حدود الإطار يحتاج تدقيقاً',
        retryable: true,
      });
    }
  }

  // 11. Assemble Canonical PageScanResult
  return {
    scanId: `scan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    pageId,
    sourceImageId: pageId,
    sourceDimensions: { width: dimensions.width, height: dimensions.height },
    readingConvention: effectiveConvention,
    status: 'complete',
    panels,
    regions: textRegions,
    issues,
    transformLedger,
    visualContext: pageContext,
    detectedGlossaryTerms,
    detectedCharacters,
    detectedRelationships,
    createdAt: Date.now(),
    version: 1,
  };
}
