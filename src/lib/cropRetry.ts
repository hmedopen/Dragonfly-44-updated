/**
 * Dragonfly 44: System #3 — Manga Scanning & Classification Engine
 * Targeted Crop Retry Engine
 * 
 * Selectively crops and re-recognizes ambiguous, clipped, or low-confidence
 * text regions with targeted high-resolution focus.
 * Bounded to avoid needless quota exhaustion.
 */

import type { TextRegion, ScanIssueFlag } from '../types/scanning';
import { normalizedToPixelBox } from './coordinateTransforms';

export interface CropResult {
  base64Data: string;
  mimeType: string;
}

/**
 * Extracts a pixel crop from an image Blob/File using an offscreen canvas.
 */
export async function cropRegionFromBlob(
  blob: Blob,
  box_2d: [number, number, number, number],
  sourceWidth: number,
  sourceHeight: number,
  paddingPixels = 15
): Promise<CropResult | null> {
  if (typeof document === 'undefined' || !blob) {
    return null;
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const [ymin, xmin, ymax, xmax] = normalizedToPixelBox(box_2d, sourceWidth, sourceHeight);

        // Add padding without exceeding image boundaries
        const cropX = Math.max(0, xmin - paddingPixels);
        const cropY = Math.max(0, ymin - paddingPixels);
        const cropW = Math.min(sourceWidth - cropX, (xmax - xmin) + paddingPixels * 2);
        const cropH = Math.min(sourceHeight - cropY, (ymax - ymin) + paddingPixels * 2);

        if (cropW <= 0 || cropH <= 0) {
          resolve(null);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.split(',')[1];
        resolve({ base64Data, mimeType: 'image/png' });
      } catch (err) {
        console.warn('[CropRetry] Failed to crop region canvas:', err);
        resolve(null);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

export interface SingleCropOCRResult {
  rawOCR: string;
  ocrAlternatives: string[];
  isAmbiguous: boolean;
  isClipped: boolean;
}

/**
 * Executes a targeted OCR query on a single image crop.
 */
export async function queryTargetedCropOCR(options: {
  crop: CropResult;
  apiKey: string;
  selectedModel: string;
}): Promise<SingleCropOCRResult> {
  const { crop, apiKey, selectedModel } = options;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel || 'gemini-3.8-flash'}:generateContent?key=${apiKey}`;

  const prompt = `You are a specialized comic OCR inspector.
Transcribe the visible text inside this cropped comic speech bubble or text region verbatim.
Do NOT translate. Do NOT invent missing or clipped characters.
If text is ambiguous, provide possible alternative readings in 'ocrAlternatives'.
If partially cut off by the crop edge, set 'isClipped': true.

Return strictly pure JSON:
{
  "rawOCR": "verbatim detected source text",
  "ocrAlternatives": ["alternative reading 1", "alternative reading 2"],
  "isAmbiguous": false,
  "isClipped": false
}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: crop.mimeType,
              data: crop.base64Data,
            },
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Crop OCR failed with status ${response.status}`);
  }

  const json = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const clean = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(clean);

  return {
    rawOCR: typeof parsed.rawOCR === 'string' ? parsed.rawOCR.trim() : '',
    ocrAlternatives: Array.isArray(parsed.ocrAlternatives) ? parsed.ocrAlternatives : [],
    isAmbiguous: Boolean(parsed.isAmbiguous),
    isClipped: Boolean(parsed.isClipped),
  };
}

/**
 * Identifies ambiguous or low-confidence regions and performs targeted crop retries.
 * Strictly bounded (default max 3 retries per page) to respect quota limits.
 */
export async function performTargetedCropRetries(options: {
  blob: Blob;
  regions: TextRegion[];
  sourceWidth: number;
  sourceHeight: number;
  apiKey: string;
  selectedModel: string;
  maxRetries?: number;
}): Promise<{ updatedRegions: TextRegion[]; retriedCount: number }> {
  const {
    blob,
    regions,
    sourceWidth,
    sourceHeight,
    apiKey,
    selectedModel,
    maxRetries = 3,
  } = options;

  if (!apiKey || !blob || regions.length === 0) {
    return { updatedRegions: regions, retriedCount: 0 };
  }

  // Filter candidate regions needing retry
  const retryCandidates = regions.filter((r) => {
    const hasFlag =
      r.flags.includes('OCR_AMBIGUOUS') ||
      r.flags.includes('TEXT_CLIPPED') ||
      r.flags.includes('REGION_BOUNDARY_UNCERTAIN');
    const isLowConfidence = r.confidence?.ocr < 0.65;
    const isEmpty = !r.rawOCR || r.rawOCR.trim().length === 0;

    return hasFlag || (isLowConfidence && !isEmpty);
  });

  if (retryCandidates.length === 0) {
    return { updatedRegions: regions, retriedCount: 0 };
  }

  const selectedForRetry = retryCandidates.slice(0, maxRetries);
  let retriedCount = 0;

  const updatedRegions = [...regions];

  for (const candidate of selectedForRetry) {
    try {
      const crop = await cropRegionFromBlob(
        blob,
        candidate.geometry.box_2d,
        sourceWidth,
        sourceHeight
      );

      if (!crop) continue;

      const ocrResult = await queryTargetedCropOCR({
        crop,
        apiKey,
        selectedModel,
      });

      retriedCount++;

      // Update region in-place
      const targetIdx = updatedRegions.findIndex((r) => r.regionId === candidate.regionId);
      if (targetIdx >= 0) {
        const existing = updatedRegions[targetIdx];
        const newFlags: ScanIssueFlag[] = [...existing.flags];

        if (ocrResult.isAmbiguous && !newFlags.includes('OCR_AMBIGUOUS')) {
          newFlags.push('OCR_AMBIGUOUS');
        }
        if (ocrResult.isClipped && !newFlags.includes('TEXT_CLIPPED')) {
          newFlags.push('TEXT_CLIPPED');
        }

        updatedRegions[targetIdx] = {
          ...existing,
          rawOCR: ocrResult.rawOCR || existing.rawOCR,
          ocrAlternatives: ocrResult.ocrAlternatives,
          confidence: {
            ...existing.confidence,
            ocr: ocrResult.isAmbiguous ? 0.70 : 0.95,
          },
          flags: newFlags,
        };
      }
    } catch (err) {
      console.warn(`[CropRetry] Failed retry for region ${candidate.regionId}:`, err);
    }
  }

  return { updatedRegions, retriedCount };
}
