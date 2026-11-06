/**
 * Dragonfly 44: System #5 — Normalization Engine
 * 
 * Enforces deterministic, idempotent normalization across canonical keys,
 * Unicode text, language identifiers, and deduplication/idempotency keys.
 */

import type { RecordType, ScopeLevel } from '../../types/memory';

/**
 * Normalizes Unicode text deliberately.
 * Preserves essential Arabic orthography (hamza distinctions أ, إ, آ, ؤ, ئ, and meaningful tanween)
 * and Japanese kana distinctions, while normalizing whitespace and compatibility representations.
 */
export function normalizeUnicodeText(input: string): string {
  if (!input) return '';
  // Normalize Unicode to canonical decomposition / composition
  // NFC preserves precomposed characters safely
  const nfc = input.normalize('NFC');
  
  // Replace zero-width spaces, non-standard line breaks, and excessive whitespace
  return nfc
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates a stable, namespaced canonical key for mergeable entities.
 * Example: 'glossary_term' + 'Shadow Step' -> 'term:shadow-step'
 * Example: 'character_profile' + 'Ren Amamiya' -> 'character:ren-amamiya'
 */
export function generateCanonicalKey(recordType: RecordType, rawNameOrKey: string): string {
  const cleaned = normalizeUnicodeText(rawNameOrKey)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FAF]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  const prefix =
    recordType === 'glossary_term'
      ? 'term'
      : recordType === 'character_profile'
      ? 'character'
      : recordType === 'relationship'
      ? 'rel'
      : recordType === 'continuity_event'
      ? 'event'
      : recordType === 'lore_fact'
      ? 'lore'
      : 'note';

  return `${prefix}:${cleaned || 'unnamed'}`;
}

/**
 * Generates a deduplication key for candidate detection.
 * Matches candidates of the same entity type and scope.
 */
export function generateDedupeKey(
  projectId: string,
  recordType: RecordType,
  canonicalKey: string,
  scopeLevel: ScopeLevel,
  scopeId?: string
): string {
  const normScopeId = scopeId ? scopeId.trim().toLowerCase() : 'global';
  return `${projectId}:${recordType}:${canonicalKey}:${scopeLevel}:${normScopeId}`;
}

/**
 * Generates an intake idempotency key to prevent duplicate intake processing on retries.
 */
export function generateIdempotencyKey(
  producer: string,
  runId: string,
  sourceRefs: string[],
  recordType: RecordType,
  canonicalKey: string,
  sourceRevision?: string | number
): string {
  const sortedRefs = [...sourceRefs].sort().join('|');
  const rev = sourceRevision !== undefined ? String(sourceRevision) : '0';
  return `idemp:${producer}:${runId}:${sortedRefs}:${recordType}:${canonicalKey}:${rev}`;
}

/**
 * Fast content hash using standard Jenkins-style 32-bit one-at-a-time hashing.
 */
export function computeContentHash(data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  let hash = 5381;
  for (let i = 0; i < json.length; i++) {
    hash = ((hash << 5) + hash) + json.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}
