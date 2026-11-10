import manifestJson from './modelManifest.json' with { type: 'json' };
import type { ModelManifestEntry, OcrRouteId } from '../../types/localOcr.ts';

export interface LocalModelManifest {
  manifestVersion: number;
  models: ModelManifestEntry[];
}

export const LOCAL_OCR_MODEL_MANIFEST: LocalModelManifest =
  manifestJson as unknown as LocalModelManifest;

export const DETECTOR_MODEL_ID = 'comic-detector-v4-s-int8';

export const ROUTE_TO_MODEL_ID: Record<OcrRouteId, string> = {
  en_ppocrv6_small: 'ppocr-v6-small-en',
  ja_zh_ppocrv6_manga: 'ppocr-v6-manga-v0.3',
  ko_ppocrv5_mobile: 'ppocr-v5-mobile-ko',
};

export function getModelManifestEntry(modelId: string): ModelManifestEntry | undefined {
  return LOCAL_OCR_MODEL_MANIFEST.models.find((m) => m.modelId === modelId);
}

export function getRequiredModelIdsForRoute(routeId: OcrRouteId): [string, string] {
  return [DETECTOR_MODEL_ID, ROUTE_TO_MODEL_ID[routeId]];
}

export function validatePinnedManifestEntry(entry: ModelManifestEntry): string[] {
  const errors: string[] = [];

  if (!entry.modelId) errors.push('Missing modelId');
  if (!entry.declaredLicense) errors.push(`${entry.modelId}: missing declaredLicense`);
  if (!entry.modelCardUrl) errors.push(`${entry.modelId}: missing modelCardUrl`);

  for (const [repo, rev] of Object.entries(entry.pinnedRevisions)) {
    if (!/^[0-9a-f]{40}$/i.test(rev)) {
      errors.push(`${entry.modelId}: revision for ${repo} is not a pinned 40-char commit SHA ("${rev}")`);
    }
  }

  for (const file of entry.files) {
    if (!/^[0-9a-f]{40}$/i.test(file.revision)) {
      errors.push(`${entry.modelId}/${file.relativePath}: revision is not a pinned 40-char commit SHA`);
    }
    if (/\/(main|master|latest)\//i.test(file.url)) {
      errors.push(`${entry.modelId}/${file.relativePath}: URL must not reference a moving branch or latest`);
    }
    if (!file.url.includes(file.revision)) {
      errors.push(`${entry.modelId}/${file.relativePath}: URL does not contain pinned revision`);
    }
    if (!/^[0-9a-f]{64}$/i.test(file.sha256)) {
      errors.push(`${entry.modelId}/${file.relativePath}: invalid sha256 checksum`);
    }
    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
      errors.push(`${entry.modelId}/${file.relativePath}: invalid sizeBytes`);
    }
  }

  return errors;
}
