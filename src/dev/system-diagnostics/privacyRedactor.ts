import type {
  DiagnosticErrorInfo,
  DiagnosticEvent,
  PrivacyManifest,
  RecordingPrivacyOptions,
} from './types';

export const DEFAULT_RECORDING_PRIVACY_OPTIONS: RecordingPrivacyOptions = {
  includeExtractedText: false,
  includeDetailedPayloads: false,
};

const SECRET_KEY_RE =
  /^(api_?key|gemini_?api_?key|general\.gemini_api_key|secret|password|authorization|auth_?header|auth_?token|access_?token|refresh_?token|bearer|credential|x-goog-api-key)$/i;

const IMAGE_KEY_RE =
  /^(image|imageData|imageBytes|base64|base64Data|inline_data|inlineData|dataUrl|blob|rawImage)$/i;

const EXTRACTED_TEXT_KEY_RE =
  /^(sourceText|originalSourceText|translatedText|rawTranslatedText|humanizedTranslatedText|rawOCR|verifiedOCR|sampleText|sampleTextForAutoRoute|ocrAlternatives|textPreview|sourceLines|translatedLines)$/i;

const DETAILED_PAYLOAD_KEY_RE =
  /^(requestPreview|responsePreview|promptPreview|systemInstruction|assembledInstructionPreview|rawResponse|rawRequest|userPrompt|contents)$/i;

const MAX_STRING_LEN = 2000;
const MAX_ARRAY_LEN = 50;
const MAX_DEPTH = 6;

export function scrubSecretPatterns(text: string): { value: string; redacted: boolean } {
  let out = text;
  let redacted = false;

  const patterns: Array<[RegExp, string]> = [
    [/([?&](?:key|api_key|token|access_token)=)[^&\s"']+/gi, '$1[REDACTED]'],
    [/\bAIza[0-9A-Za-z_-]{10,}\b/g, '[REDACTED_API_KEY]'],
    [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]'],
    [/(x-goog-api-key\s*[:=]\s*)[^\s"',;]+/gi, '$1[REDACTED]'],
    [/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{16,}/gi, '[OMITTED_IMAGE_DATA_URL]'],
  ];

  for (const [re, replacement] of patterns) {
    if (re.test(out)) {
      redacted = true;
      out = out.replace(re, replacement);
    }
  }

  return { value: out, redacted };
}

function redactUnknown(
  value: unknown,
  keyName: string,
  privacy: RecordingPrivacyOptions,
  redactedFields: Set<string>,
  path: string,
  depth: number
): unknown {
  if (value === null || value === undefined) return value;

  if (SECRET_KEY_RE.test(keyName)) {
    redactedFields.add(path || keyName);
    return '[REDACTED_SECRET]';
  }

  if (IMAGE_KEY_RE.test(keyName)) {
    redactedFields.add(path || keyName);
    if (typeof value === 'string') {
      return `[OMITTED_IMAGE_DATA len=${value.length}]`;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      const byteLen = value instanceof Uint8Array ? value.byteLength : value.byteLength;
      return `[OMITTED_BINARY_IMAGE bytes=${byteLen}]`;
    }
    return '[OMITTED_IMAGE_DATA]';
  }

  if (!privacy.includeExtractedText && EXTRACTED_TEXT_KEY_RE.test(keyName)) {
    redactedFields.add(path || keyName);
    if (typeof value === 'string') {
      return `[TEXT_REDACTED len=${value.length}]`;
    }
    if (Array.isArray(value)) {
      return `[TEXT_LIST_REDACTED count=${value.length}]`;
    }
    return '[TEXT_REDACTED]';
  }

  if (!privacy.includeDetailedPayloads && DETAILED_PAYLOAD_KEY_RE.test(keyName)) {
    redactedFields.add(path || keyName);
    if (typeof value === 'string') {
      return `[DETAILED_PAYLOAD_OMITTED len=${value.length}]`;
    }
    return '[DETAILED_PAYLOAD_OMITTED]';
  }

  if (typeof value === 'string') {
    const scrubbed = scrubSecretPatterns(value);
    if (scrubbed.redacted) {
      redactedFields.add(path || keyName);
    }
    // Never retain huge raw base64 blobs even under unexpected keys
    if (scrubbed.value.length > 512 && /^[A-Za-z0-9+/=]+$/.test(scrubbed.value.slice(0, 128))) {
      redactedFields.add(path || keyName);
      return `[OMITTED_BASE64_STRING len=${scrubbed.value.length}]`;
    }
    if (scrubbed.value.length > MAX_STRING_LEN) {
      return `${scrubbed.value.slice(0, MAX_STRING_LEN)}... [truncated ${scrubbed.value.length - MAX_STRING_LEN} chars]`;
    }
    return scrubbed.value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const byteLen = value instanceof Uint8Array ? value.byteLength : value.byteLength;
    redactedFields.add(path || keyName);
    return `[BINARY_OMITTED bytes=${byteLen}]`;
  }

  if (depth >= MAX_DEPTH) {
    return '[MAX_DEPTH_OMITTED]';
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, MAX_ARRAY_LEN);
    const mapped = sliced.map((item, idx) =>
      redactUnknown(item, keyName, privacy, redactedFields, `${path}[${idx}]`, depth + 1)
    );
    if (value.length > MAX_ARRAY_LEN) {
      mapped.push(`[+${value.length - MAX_ARRAY_LEN} more items]`);
    }
    return mapped;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${k}` : k;
      result[k] = redactUnknown(v, k, privacy, redactedFields, childPath, depth + 1);
    }
    return result;
  }

  return String(value);
}

export function sanitizeErrorInfo(err: unknown): DiagnosticErrorInfo | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    const rawMsg = scrubSecretPatterns(err.message || err.name || 'Error').value;
    const rawStack = err.stack ? scrubSecretPatterns(err.stack).value : undefined;
    const errWithCode = err as Error & { code?: unknown };
    return {
      name: err.name,
      message: rawMsg.slice(0, MAX_STRING_LEN),
      ...(rawStack ? { stack: rawStack.slice(0, 4000) } : {}),
      ...(typeof errWithCode.code === 'string' || typeof errWithCode.code === 'number'
        ? { code: String(errWithCode.code) }
        : {}),
    };
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const msg = typeof obj.message === 'string' ? obj.message : JSON.stringify(obj);
    return {
      name: typeof obj.name === 'string' ? obj.name : undefined,
      message: scrubSecretPatterns(msg).value.slice(0, MAX_STRING_LEN),
      stack: typeof obj.stack === 'string' ? scrubSecretPatterns(obj.stack).value.slice(0, 4000) : undefined,
      code: obj.code !== undefined ? String(obj.code) : undefined,
    };
  }
  return {
    message: scrubSecretPatterns(String(err)).value.slice(0, MAX_STRING_LEN),
  };
}

export function redactPayload(
  payload: Record<string, unknown> | undefined,
  privacy: RecordingPrivacyOptions = DEFAULT_RECORDING_PRIVACY_OPTIONS
): { sanitized: Record<string, unknown> | undefined; redactedFields: string[] } {
  if (!payload) return { sanitized: undefined, redactedFields: [] };
  const redactedFields = new Set<string>();
  const sanitized = redactUnknown(payload, '', privacy, redactedFields, '', 0) as Record<
    string,
    unknown
  >;
  return {
    sanitized,
    redactedFields: Array.from(redactedFields),
  };
}

export function redactEventForPrivacy(
  event: DiagnosticEvent,
  privacy: RecordingPrivacyOptions
): DiagnosticEvent {
  const explanationScrub = scrubSecretPatterns(event.explanation);
  const { sanitized, redactedFields } = redactPayload(event.payload, privacy);
  const mergedRedacted = Array.from(
    new Set([...(event.redactedFields || []), ...redactedFields])
  );
  return {
    ...event,
    explanation: explanationScrub.value,
    payload: sanitized,
    error: event.error ? sanitizeErrorInfo(event.error) : undefined,
    ...(mergedRedacted.length > 0 ? { redactedFields: mergedRedacted } : {}),
  };
}

export function buildPrivacyManifest(
  privacy: RecordingPrivacyOptions,
  events: DiagnosticEvent[]
): PrivacyManifest {
  let totalRedactedFields = 0;
  for (const evt of events) {
    totalRedactedFields += evt.redactedFields?.length || 0;
  }

  const notes: string[] = [
    'API keys, authorization headers, bearer tokens, and secrets are unconditionally redacted.',
    'Full source page images and raw base64 artwork payloads are never recorded.',
    privacy.includeExtractedText
      ? 'Extracted OCR and translated text snippets are INCLUDED by explicit user setting.'
      : 'Extracted OCR and translated text snippets are REDACTED.',
    privacy.includeDetailedPayloads
      ? 'Sanitized request/response metadata previews are INCLUDED by explicit user setting.'
      : 'Detailed request/response previews are OMITTED.',
  ];

  return {
    apiKeysAndSecretsRedacted: true,
    sourceImagesExcluded: true,
    includeExtractedText: privacy.includeExtractedText,
    includeDetailedPayloads: privacy.includeDetailedPayloads,
    totalRedactedFields,
    notes,
  };
}
