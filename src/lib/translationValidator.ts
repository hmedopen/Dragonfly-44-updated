/**
 * Deterministic Structural Translation Validator
 *
 * Provides fast, local, zero-latency validation of API responses.
 * In accordance with System #2 Refinement #4:
 * "Keep deterministic structural validation local. Do not pretend that simple TypeScript checks
 * can establish semantic fidelity or linguistic authenticity."
 *
 * This module enforces:
 * - Clean JSON extraction and markdown codeblock stripping
 * - Response schema conformance and required field presence
 * - Omission and extreme length anomaly detection
 * - Bounded recovery without recursive model loops
 */

export interface ValidationResult<T> {
  isValid: boolean;
  data: T | null;
  errors: string[];
  warnings: string[];
  wasRecovered: boolean;
}

/**
 * Strips markdown codeblock wrappers (```json ... ```) and cleans whitespace.
 */
export function extractCleanJson(rawResponse: string): string {
  if (!rawResponse || typeof rawResponse !== 'string') return '';

  let clean = rawResponse.trim();

  // Strip leading markdown json block
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/i, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '');
  }

  // Strip trailing markdown fence
  if (clean.endsWith('```')) {
    clean = clean.replace(/\s*```$/, '');
  }

  return clean.trim();
}

/**
 * Validates and normalizes single bubble translation JSON.
 */
export function validateSingleBubbleOutput(rawText: string, sourceText?: string): ValidationResult<{
  sourceText?: string;
  translatedText: string;
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let wasRecovered = false;

  if (!rawText || rawText.trim().length === 0) {
    return {
      isValid: false,
      data: null,
      errors: ['Model returned an empty response.'],
      warnings,
      wasRecovered: false,
    };
  }

  const cleanJson = extractCleanJson(rawText);
  let parsed: any = null;

  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    // Attempt recovery if the model returned plain text rather than JSON
    if (cleanJson && !cleanJson.startsWith('{') && !cleanJson.startsWith('[')) {
      wasRecovered = true;
      warnings.push('Model returned unformatted text instead of JSON; recovered as translatedText.');
      parsed = { translatedText: cleanJson };
    } else {
      errors.push(`Failed to parse JSON response: ${(err as Error).message}`);
      return { isValid: false, data: null, errors, warnings, wasRecovered: false };
    }
  }

  // Look for translation under common keys if translatedText is missing
  const rawArabic =
    parsed.translatedText ??
    parsed.arabic ??
    parsed.translation ??
    parsed.textAr ??
    '';

  const translatedText = String(rawArabic).trim();

  if (!translatedText && sourceText && sourceText.trim().length > 0) {
    errors.push('Translated text field is empty despite non-empty source text.');
  }

  // Omission heuristic: if source text has substantial content (>20 chars) but translation has <2 chars
  if (sourceText && sourceText.trim().length > 20 && translatedText.length < 2) {
    warnings.push('Suspiciously brief translation detected for a multi-word dialogue bubble.');
  }

  const resultSourceText = parsed.sourceText
    ? String(parsed.sourceText).trim()
    : undefined;

  return {
    isValid: errors.length === 0,
    data: errors.length === 0 ? { sourceText: resultSourceText, translatedText } : null,
    errors,
    warnings,
    wasRecovered,
  };
}

/**
 * Validates page scan structured output.
 */
export function validatePageScanOutput(rawText: string): ValidationResult<{
  bubbles: any[];
  pageContext: string;
  detectedGlossaryTerms: any[];
  detectedCharacters: any[];
  detectedRelationships: any[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawText || rawText.trim().length === 0) {
    return {
      isValid: false,
      data: null,
      errors: ['Model returned an empty response candidate.'],
      warnings,
      wasRecovered: false,
    };
  }

  const cleanJson = extractCleanJson(rawText);
  let parsed: any = null;

  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    errors.push(`Failed to parse Page Scan JSON: ${(err as Error).message}`);
    return { isValid: false, data: null, errors, warnings, wasRecovered: false };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('Parsed JSON root is not an object.');
    return { isValid: false, data: null, errors, warnings, wasRecovered: false };
  }

  const bubbles = Array.isArray(parsed.bubbles) ? parsed.bubbles : [];
  if (!Array.isArray(parsed.bubbles)) {
    warnings.push('Response missing "bubbles" array; defaulting to empty list.');
  }

  return {
    isValid: errors.length === 0,
    data: {
      bubbles,
      pageContext: typeof parsed.pageContext === 'string' ? parsed.pageContext : '',
      detectedGlossaryTerms: Array.isArray(parsed.detectedGlossaryTerms) ? parsed.detectedGlossaryTerms : [],
      detectedCharacters: Array.isArray(parsed.detectedCharacters) ? parsed.detectedCharacters : [],
      detectedRelationships: Array.isArray(parsed.detectedRelationships) ? parsed.detectedRelationships : [],
    },
    errors,
    warnings,
    wasRecovered: false,
  };
}

const VALID_GENERIC_CLASSES = new Set([
  'dialogue',
  'thought',
  'narration',
  'caption',
  'vocalization',
  'sfx',
  'environmental_text',
  'unknown',
]);

/**
 * Validates System #3 Manga Scanning Engine structured output.
 * Robustly parses panels, verbatim text regions, classification, and visual evidence.
 */
export function validateSystem3ScanOutput(rawText: string): ValidationResult<{
  pageContext: string;
  readingConventionCandidate?: string;
  panels: Array<{ panelId: string; box_2d: [number, number, number, number] }>;
  regions: Array<{
    regionId: string;
    box_2d: [number, number, number, number];
    rawOCR: string;
    ocrAlternatives?: string[];
    primaryClass: string;
    isVertical?: boolean;
    speakerCandidate?: string;
    visualEvidence?: string;
    isAmbiguous?: boolean;
    isClipped?: boolean;
  }>;
  detectedCharacters: any[];
  detectedGlossaryTerms: any[];
  detectedRelationships: any[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let wasRecovered = false;

  if (!rawText || rawText.trim().length === 0) {
    return {
      isValid: false,
      data: null,
      errors: ['Model returned an empty response candidate.'],
      warnings,
      wasRecovered: false,
    };
  }

  const cleanJson = extractCleanJson(rawText);
  let parsed: any = null;

  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    errors.push(`Failed to parse System #3 scan JSON: ${(err as Error).message}`);
    return { isValid: false, data: null, errors, warnings, wasRecovered: false };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('Parsed scan JSON root is not an object.');
    return { isValid: false, data: null, errors, warnings, wasRecovered: false };
  }

  // Support both 'regions' and legacy 'bubbles' key for maximum resilience
  const rawRegionList = Array.isArray(parsed.regions)
    ? parsed.regions
    : Array.isArray(parsed.bubbles)
    ? parsed.bubbles
    : [];

  if (!Array.isArray(parsed.regions) && !Array.isArray(parsed.bubbles)) {
    warnings.push('Scan response missing regions array; defaulting to empty list.');
  }

  // Validate panels
  const rawPanels = Array.isArray(parsed.panels) ? parsed.panels : [];
  const validatedPanels = rawPanels.map((p: any, idx: number) => {
    const rawBox = Array.isArray(p.box_2d) && p.box_2d.length === 4 ? p.box_2d : [0, 0, 1000, 1000];
    const safeBox: [number, number, number, number] = [
      Math.max(0, Math.min(1000, Number(rawBox[0]) || 0)),
      Math.max(0, Math.min(1000, Number(rawBox[1]) || 0)),
      Math.max(0, Math.min(1000, Number(rawBox[2]) || 1000)),
      Math.max(0, Math.min(1000, Number(rawBox[3]) || 1000)),
    ];
    return {
      panelId: typeof p.panelId === 'string' ? p.panelId : `panel-${idx + 1}`,
      box_2d: safeBox,
    };
  });

  // Validate regions
  const validatedRegions = rawRegionList.map((r: any, idx: number) => {
    const rawBox = Array.isArray(r.box_2d) && r.box_2d.length === 4 ? r.box_2d : [200, 200, 400, 400];
    let [ymin, xmin, ymax, xmax] = rawBox.map((v: any) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0))));
    if (ymin >= ymax) ymax = Math.min(1000, ymin + 40);
    if (xmin >= xmax) xmax = Math.min(1000, xmin + 40);

    const rawOCR = String(r.rawOCR ?? r.sourceText ?? '').trim();
    const primaryClassCandidate = String(r.primaryClass ?? r.type ?? 'dialogue').toLowerCase();
    const primaryClass = VALID_GENERIC_CLASSES.has(primaryClassCandidate)
      ? primaryClassCandidate
      : 'unknown';

    return {
      regionId: typeof r.regionId === 'string' ? r.regionId : `r-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      box_2d: [ymin, xmin, ymax, xmax] as [number, number, number, number],
      rawOCR,
      ocrAlternatives: Array.isArray(r.ocrAlternatives) ? r.ocrAlternatives.map(String) : [],
      primaryClass,
      isVertical: Boolean(r.isVertical),
      speakerCandidate: typeof r.speakerCandidate === 'string' ? r.speakerCandidate : undefined,
      visualEvidence: typeof r.visualEvidence === 'string' ? r.visualEvidence : undefined,
      isAmbiguous: Boolean(r.isAmbiguous),
      isClipped: Boolean(r.isClipped),
    };
  });

  return {
    isValid: errors.length === 0,
    data: {
      pageContext: typeof parsed.pageContext === 'string' ? parsed.pageContext : '',
      readingConventionCandidate: typeof parsed.readingConventionCandidate === 'string' ? parsed.readingConventionCandidate : undefined,
      panels: validatedPanels,
      regions: validatedRegions,
      detectedCharacters: Array.isArray(parsed.detectedCharacters) ? parsed.detectedCharacters : [],
      detectedGlossaryTerms: Array.isArray(parsed.detectedGlossaryTerms) ? parsed.detectedGlossaryTerms : [],
      detectedRelationships: Array.isArray(parsed.detectedRelationships) ? parsed.detectedRelationships : [],
    },
    errors,
    warnings,
    wasRecovered,
  };
}
