/**
 * Dragonfly 44: System #5 — Schema & Semantic Validator
 * 
 * Implements strict JSON parsing, envelope validation, schema & bounds checking,
 * semantic state transition validation, and prompt-injection detection.
 */

import type {
  KnowledgeRecord,
  RecordType,
  RecordStatus,
  TrustClass,
  ResultError,
} from '../../types/memory';
import { MEMORY_ISSUE_CODES } from '../../types/memory';

export const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB
export const MAX_NESTING_DEPTH = 10;
export const MAX_ARRAY_LENGTH = 200;
export const MAX_STRING_LENGTH = 10_000;

const VALID_RECORD_TYPES: Set<RecordType> = new Set([
  'glossary_term',
  'character_profile',
  'lore_fact',
  'relationship',
  'continuity_event',
  'user_note',
]);

const VALID_RECORD_STATUSES: Set<RecordStatus> = new Set([
  'candidate',
  'pending_approval',
  'approved',
  'disputed',
  'superseded',
  'rejected',
  'archived',
  'quarantined',
  'needs_evidence',
]);

const VALID_TRUST_CLASSES: Set<TrustClass> = new Set([
  'user_confirmed',
  'imported_user_data',
  'system_observed',
  'model_inferred',
]);

const ALLOWED_TRANSITIONS: Record<RecordStatus, Set<RecordStatus>> = {
  candidate: new Set(['needs_evidence', 'pending_approval', 'approved', 'rejected', 'quarantined']),
  needs_evidence: new Set(['candidate', 'pending_approval', 'rejected', 'quarantined']),
  pending_approval: new Set(['approved', 'rejected', 'disputed']),
  approved: new Set(['disputed', 'superseded', 'archived']),
  disputed: new Set(['approved', 'superseded', 'rejected', 'archived']),
  superseded: new Set(['archived']),
  rejected: new Set(['candidate']), // Allowed only via explicit reopen action
  quarantined: new Set(['candidate', 'rejected']),
  archived: new Set([]), // Terminal state
};

// Injection indicators that must never be treated as executable directives
const INJECTION_PATTERNS = [
  /system\s*:\s*ignore\s+previous/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /unrestricted\s+ai\s+mode/i,
  /bypass\s+all\s+rules/i,
  /<script\b[^>]*>/i,
  /javascript\s*:/i,
];

/**
 * Validates state transition legality according to Section 4.5.
 */
export function isValidStateTransition(from: RecordStatus, to: RecordStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}

/**
 * Checks for prompt-injection markers in text to ensure it remains untrusted inert data.
 */
export function detectPromptInjectionMarkers(text: string): { hasInjection: boolean; matchedPattern?: string } {
  if (!text || typeof text !== 'string') return { hasInjection: false };
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { hasInjection: true, matchedPattern: pattern.source };
    }
  }
  return { hasInjection: false };
}

/**
 * Recursively validates bounds and depth of parsed JSON objects.
 */
function validateStructureBounds(obj: unknown, currentDepth: number, errors: ResultError[]): void {
  if (currentDepth > MAX_NESTING_DEPTH) {
    errors.push({
      code: MEMORY_ISSUE_CODES.PAYLOAD_LIMIT_EXCEEDED,
      message: `Payload nesting depth exceeded maximum of ${MAX_NESTING_DEPTH}`,
    });
    return;
  }

  if (typeof obj === 'string') {
    if (obj.length > MAX_STRING_LENGTH) {
      errors.push({
        code: MEMORY_ISSUE_CODES.PAYLOAD_LIMIT_EXCEEDED,
        message: `String length ${obj.length} exceeded maximum limit of ${MAX_STRING_LENGTH}`,
      });
    }
    const injection = detectPromptInjectionMarkers(obj);
    if (injection.hasInjection) {
      errors.push({
        code: MEMORY_ISSUE_CODES.UNTRUSTED_INSTRUCTION_DETECTED,
        message: `Untrusted instruction-like content detected in string: ${injection.matchedPattern}`,
      });
    }
  } else if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) {
      errors.push({
        code: MEMORY_ISSUE_CODES.PAYLOAD_LIMIT_EXCEEDED,
        message: `Array length ${obj.length} exceeded maximum limit of ${MAX_ARRAY_LENGTH}`,
      });
    }
    for (const item of obj) {
      validateStructureBounds(item, currentDepth + 1, errors);
    }
  } else if (obj !== null && typeof obj === 'object') {
    // Prevent prototype pollution
    if (Object.prototype.hasOwnProperty.call(obj, '__proto__') || Object.prototype.hasOwnProperty.call(obj, 'constructor')) {
      errors.push({
        code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
        message: 'Forbidden property (__proto__ or constructor) in payload structure',
      });
      return;
    }

    const entries = Object.entries(obj);
    for (const [, val] of entries) {
      validateStructureBounds(val, currentDepth + 1, errors);
    }
  }
}

/**
 * Detects duplicate keys in raw JSON string.
 */
function detectDuplicateKeys(jsonString: string): string | null {
  const keyRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g;
  const stack: Set<string>[] = [new Set()];
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
      stack.push(new Set());
    } else if (char === '}') {
      if (depth > 0) {
        depth--;
        stack.pop();
      }
    }
  }

  // Fast regex scan on flat objects
  let match: RegExpExecArray | null;
  const rootKeys = new Set<string>();
  const topObjectMatch = jsonString.match(/^\{[\s\S]*\}$/);
  if (topObjectMatch) {
    while ((match = keyRegex.exec(jsonString)) !== null) {
      const key = match[1];
      if (rootKeys.has(key)) {
        return key;
      }
      rootKeys.add(key);
    }
  }

  return null;
}

/**
 * Strict JSON parser enforcing size limits, depth limits, and syntax integrity.
 */
export function strictParseJson<T = any>(
  rawText: string
): { success: true; data: T } | { success: false; errors: ResultError[] } {
  if (!rawText || typeof rawText !== 'string') {
    return {
      success: false,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: 'Empty or non-string input provided to parser',
        },
      ],
    };
  }

  if (rawText.length > MAX_PAYLOAD_BYTES) {
    return {
      success: false,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.PAYLOAD_LIMIT_EXCEEDED,
          message: `Payload size (${rawText.length} bytes) exceeds limit of ${MAX_PAYLOAD_BYTES} bytes`,
        },
      ],
    };
  }

  // Check duplicate keys
  const duplicateKey = detectDuplicateKeys(rawText);
  if (duplicateKey) {
    return {
      success: false,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `Duplicate key "${duplicateKey}" detected in JSON payload`,
        },
      ],
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    return {
      success: false,
      errors: [
        {
          code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
          message: `JSON syntax error: ${err?.message || String(err)}`,
        },
      ],
    };
  }

  const errors: ResultError[] = [];
  validateStructureBounds(parsed, 1, errors);
  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: parsed as T };
}

/**
 * Validates a Canonical Knowledge Record against the System #5 contract.
 */
export function validateKnowledgeRecord(
  record: Partial<KnowledgeRecord>
): { valid: boolean; errors: ResultError[] } {
  const errors: ResultError[] = [];

  // 1. Required Envelope Fields
  if (!record.record_id || typeof record.record_id !== 'string') {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'record_id',
      message: 'record_id is required and must be a non-empty string',
    });
  }

  if (!record.record_type || !VALID_RECORD_TYPES.has(record.record_type)) {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'record_type',
      message: `record_type must be one of: ${Array.from(VALID_RECORD_TYPES).join(', ')}`,
    });
  }

  if (!record.project_id || typeof record.project_id !== 'string') {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'project_id',
      message: 'project_id is required',
    });
  }

  if (!record.canonical_key || typeof record.canonical_key !== 'string') {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'canonical_key',
      message: 'canonical_key is required',
    });
  }

  if (!record.status || !VALID_RECORD_STATUSES.has(record.status)) {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'status',
      message: `status must be one of: ${Array.from(VALID_RECORD_STATUSES).join(', ')}`,
    });
  }

  if (!record.trust_class || !VALID_TRUST_CLASSES.has(record.trust_class)) {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'trust_class',
      message: `trust_class must be one of: ${Array.from(VALID_TRUST_CLASSES).join(', ')}`,
    });
  }

  if (typeof record.revision !== 'number' || record.revision < 1) {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'revision',
      message: 'revision must be a positive integer starting at 1',
    });
  }

  if (!record.schema_version || record.schema_version !== '1.0') {
    errors.push({
      code: MEMORY_ISSUE_CODES.UNSUPPORTED_SCHEMA_VERSION,
      path: 'schema_version',
      message: 'Unsupported schema_version. Current supported version is "1.0"',
    });
  }

  // 2. Scope checks & Cross-Project Validation
  if (!record.scope || !record.scope.level) {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'scope',
      message: 'scope object with a valid level is required',
    });
  } else if (record.scope.project_id && record.project_id && record.scope.project_id !== record.project_id) {
    errors.push({
      code: MEMORY_ISSUE_CODES.CROSS_PROJECT_REFERENCE,
      path: 'scope.project_id',
      message: 'Scope project_id does not match record project_id',
    });
  }

  // 3. Provenance Integrity
  if (record.trust_class !== 'user_confirmed') {
    if (!record.provenance || !Array.isArray(record.provenance) || record.provenance.length === 0) {
      errors.push({
        code: MEMORY_ISSUE_CODES.MISSING_PROVENANCE,
        path: 'provenance',
        message: 'Non-user-authored facts must have at least one provenance reference',
      });
    } else {
      for (const prov of record.provenance) {
        if (!prov.source_refs || !Array.isArray(prov.source_refs) || prov.source_refs.length === 0) {
          errors.push({
            code: MEMORY_ISSUE_CODES.MISSING_PROVENANCE,
            path: 'provenance.source_refs',
            message: 'Provenance item must contain non-empty source_refs',
          });
        }
      }
    }
  }

  // 4. Payload Schema Verification
  if (!record.payload || typeof record.payload !== 'object') {
    errors.push({
      code: MEMORY_ISSUE_CODES.INVALID_PROPOSAL_ENVELOPE,
      path: 'payload',
      message: 'payload must be a non-null object',
    });
  } else {
    validatePayloadContent(record.record_type, record.payload, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validatePayloadContent(
  recordType: RecordType | undefined,
  payload: Record<string, any>,
  errors: ResultError[]
): void {
  if (!recordType) return;

  switch (recordType) {
    case 'glossary_term':
      if (!payload.source_form || typeof payload.source_form !== 'string' || !payload.source_form.trim()) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.source_form',
          message: 'GlossaryTerm requires non-empty source_form',
        });
      }
      if (!payload.approved_rendering || typeof payload.approved_rendering !== 'string' || !payload.approved_rendering.trim()) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.approved_rendering',
          message: 'GlossaryTerm requires non-empty approved_rendering',
        });
      }
      break;

    case 'character_profile':
      if (!payload.canonical_name || typeof payload.canonical_name !== 'string' || !payload.canonical_name.trim()) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.canonical_name',
          message: 'CharacterProfile requires non-empty canonical_name',
        });
      }
      break;

    case 'lore_fact':
      if (!payload.assertion || typeof payload.assertion !== 'string' || !payload.assertion.trim()) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.assertion',
          message: 'LoreFact requires non-empty assertion',
        });
      }
      break;

    case 'relationship':
      if (!payload.speaker || !payload.addressee) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.speaker/addressee',
          message: 'Relationship requires both speaker and addressee',
        });
      }
      break;

    case 'continuity_event':
      if (!payload.event_name || !payload.description) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.event_name/description',
          message: 'ContinuityEvent requires event_name and description',
        });
      }
      break;

    case 'user_note':
      if (!payload.note_text || typeof payload.note_text !== 'string' || !payload.note_text.trim()) {
        errors.push({
          code: MEMORY_ISSUE_CODES.SEMANTIC_VALIDATION_FAILED,
          path: 'payload.note_text',
          message: 'UserNote requires non-empty note_text',
        });
      }
      break;
  }
}
