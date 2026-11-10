import manifestJson from './modelManifest.json' with { type: 'json' };
import type {
  ModelDistributionPolicy,
  ModelManifestEntry,
  OcrRouteId,
  RedistributionStatus,
} from '../../types/localOcr.ts';

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

const ALLOWED_REDISTRIBUTION_STATUSES = new Set<RedistributionStatus>([
  'dev_only_unverified_provenance',
  'dev_only_noncommercial_dataset',
  'approved_for_redistribution',
]);

export function getModelManifestEntry(modelId: string): ModelManifestEntry | undefined {
  return LOCAL_OCR_MODEL_MANIFEST.models.find((m) => m.modelId === modelId);
}

export function getRequiredModelIdsForRoute(routeId: OcrRouteId): [string, string] {
  return [DETECTOR_MODEL_ID, ROUTE_TO_MODEL_ID[routeId]];
}

export function evaluateModelDistributionPolicy(
  entry: ModelManifestEntry,
  options: { isProduction?: boolean } = {}
): ModelDistributionPolicy {
  const isProduction = options.isProduction ?? true;
  const status = entry?.redistributionStatus;
  const validStatus = ALLOWED_REDISTRIBUTION_STATUSES.has(status);

  const provenanceUnresolved =
    !validStatus || status === 'dev_only_unverified_provenance';
  const developmentOnly =
    !validStatus || status !== 'approved_for_redistribution';
  const redistributionApproved =
    validStatus && status === 'approved_for_redistribution';
  // Commercial clearance is never inferred solely from Apache-2.0 / approved_for_redistribution
  const commercialDistributionCleared =
    redistributionApproved &&
    (entry as ModelManifestEntry & { commercialDistributionCleared?: boolean })
      .commercialDistributionCleared === true;

  const productionEligible =
    !developmentOnly && redistributionApproved && !provenanceUnresolved;
  const downloadPermitted = isProduction ? productionEligible : validStatus;
  const activationPermitted = isProduction ? productionEligible : validStatus;

  let rejectionReason: string | null = null;
  if (!validStatus) {
    rejectionReason = `Model "${entry?.modelId ?? 'unknown'}" has invalid or missing redistributionStatus "${String(status)}".`;
  } else if (isProduction && !productionEligible) {
    rejectionReason = `Model "${entry.modelId}" is restricted to development builds (redistributionStatus="${status}") and cannot be downloaded or activated in production.`;
  }

  return {
    developmentOnly,
    downloadPermitted,
    activationPermitted,
    redistributionApproved,
    commercialDistributionCleared,
    provenanceUnresolved,
    rejectionReason,
  };
}

export function validatePinnedManifestEntry(entry: ModelManifestEntry): string[] {
  const errors: string[] = [];

  if (!entry.modelId || !/^[a-zA-Z0-9._-]+$/.test(entry.modelId)) {
    errors.push(`Invalid or missing modelId "${String(entry.modelId)}"`);
  }
  if (!entry.declaredLicense) errors.push(`${entry.modelId}: missing declaredLicense`);
  if (!entry.modelCardUrl || !entry.modelCardUrl.startsWith('https://')) {
    errors.push(`${entry.modelId}: missing or non-HTTPS modelCardUrl`);
  }
  if (!ALLOWED_REDISTRIBUTION_STATUSES.has(entry.redistributionStatus)) {
    errors.push(
      `${entry.modelId}: invalid redistributionStatus "${String(entry.redistributionStatus)}"`
    );
  }
  const pinnedEntries = Object.entries(entry.pinnedRevisions || {});
  if (pinnedEntries.length === 0) {
    errors.push(`${entry.modelId}: missing pinnedRevisions`);
  }
  for (const [repo, rev] of pinnedEntries) {
    if (!/^[0-9a-f]{40}$/i.test(rev)) {
      errors.push(`${entry.modelId}: revision for ${repo} is not a pinned 40-char commit SHA ("${rev}")`);
    }
  }

  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    errors.push(`${entry.modelId}: missing files`);
  }
  for (const file of entry.files || []) {
    if (
      !file.relativePath ||
      file.relativePath.includes('..') ||
      file.relativePath.startsWith('/') ||
      file.relativePath.startsWith('\\')
    ) {
      errors.push(`${entry.modelId}: unsafe relativePath "${String(file.relativePath)}"`);
    }
    const expectedRepoRev = entry.pinnedRevisions?.[file.upstreamRepo];
    if (!expectedRepoRev || expectedRepoRev !== file.revision) {
      errors.push(
        `${entry.modelId}/${file.relativePath}: file revision does not match pinnedRevisions["${file.upstreamRepo}"]`
      );
    }
    if (!/^[0-9a-f]{40}$/i.test(String(file.revision || ''))) {
      errors.push(`${entry.modelId}/${file.relativePath}: revision is not a pinned 40-char commit SHA`);
    }
    if (!String(file.url || '').startsWith('https://')) {
      errors.push(`${entry.modelId}/${file.relativePath}: URL must use HTTPS`);
    }
    if (/\/(main|master|latest)\//i.test(file.url)) {
      errors.push(`${entry.modelId}/${file.relativePath}: URL must not reference a moving branch or latest`);
    }
    if (!file.url.includes(file.revision)) {
      errors.push(`${entry.modelId}/${file.relativePath}: URL does not contain pinned revision`);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(file.sha256 || ''))) {
      errors.push(`${entry.modelId}/${file.relativePath}: invalid sha256 checksum`);
    }
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
      errors.push(`${entry.modelId}/${file.relativePath}: invalid sizeBytes`);
    }
  }

  return errors;
}
