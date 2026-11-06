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
