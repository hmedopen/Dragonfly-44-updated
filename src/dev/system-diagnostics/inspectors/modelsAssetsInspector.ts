import {
  evaluateModelDistributionPolicy,
  LOCAL_OCR_MODEL_MANIFEST,
  validatePinnedManifestEntry,
} from '../../../lib/localOcr/modelManifest';
import {
  fetchElectronModelCacheInspection,
  getFolioScriptBridge,
} from '../adapters/electronBridge';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface ModelsAssetsInspectorDeps {
  inspectCache?: typeof fetchElectronModelCacheInspection;
  getBridge?: typeof getFolioScriptBridge;
  fetchImpl?: typeof fetch;
}

export function createModelsAssetsInspector(deps: ModelsAssetsInspectorDeps = {}): SubsystemInspector {
  const inspectElectronCache = deps.inspectCache ?? fetchElectronModelCacheInspection;
  const getBridge = deps.getBridge ?? getFolioScriptBridge;
  const fetchFn = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);

  return {
    id: 'models-assets',
    name: 'Models & Assets',
    description: 'Local OCR model manifest, pinned SHA-256 verification, cache integrity, and ORT WASM runtime assets.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'Pinned manifest & distribution policy audit', tier: 'read_only_check', notes: 'Validates modelManifest.json revisions, URLs, and checksums.' },
      { capability: 'Disk model cache & SHA-256 verification', tier: 'read_only_check', notes: 'Uses Electron modelManager in desktop runtime; unsupported in browser dev.' },
      { capability: 'ONNX Runtime WASM asset availability', tier: 'read_only_check', notes: 'Probes /ort/ort-wasm-simd-threaded.mjs in renderer.' },
    ],
    checks: [
      {
        checkId: 'model-manifest-validation',
        name: 'Local Model Manifest & Policy Audit',
        description: 'Validates all pinned commit SHAs, HTTPS URLs, SHA-256 digests, and dev/prod redistribution policies.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'local-model-cache-status',
        name: 'Installed Model Cache Integrity',
        description: 'Inspects local model files, sizes, and SHA-256 integrity via Electron modelManager.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'ort-wasm-assets',
        name: 'ONNX Runtime WASM Assets',
        description: 'Checks whether ORT WASM worker runtime scripts are reachable from the renderer.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, _context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];

      if (checkId === 'model-manifest-validation') {
        const models = LOCAL_OCR_MODEL_MANIFEST.models || [];
        let devOnlyCount = 0;

        for (const entry of models) {
          const errs = validatePinnedManifestEntry(entry);
          for (const errMsg of errs) {
            findings.push({
              findingId: `manifest-err-${entry.modelId}-${start}`,
              subsystem: 'models-assets',
              checkId,
              code: 'MANIFEST_VALIDATION_ERROR',
              severity: 'error',
              title: `Manifest error in ${entry.modelId}`,
              explanation: errMsg,
              timestamp: Date.now(),
            });
          }

          const prodPolicy = evaluateModelDistributionPolicy(entry, { isProduction: true });
          if (prodPolicy.developmentOnly) {
            devOnlyCount++;
            findings.push({
              findingId: `manifest-devonly-${entry.modelId}`,
              subsystem: 'models-assets',
              checkId,
              code: 'MODEL_DEV_ONLY_POLICY',
              severity: 'info',
              title: `${entry.modelId} restricted to development builds`,
              explanation: prodPolicy.rejectionReason || `redistributionStatus="${entry.redistributionStatus}".`,
              timestamp: Date.now(),
            });
          }
        }

        return {
          checkId,
          subsystem: 'models-assets',
          name: 'Local Model Manifest & Policy Audit',
          safety: 'read_only',
          status: findings.some((f) => f.severity === 'error') ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Validated ${models.length} pinned model manifest entries (${devOnlyCount} dev-only policy restricted in production).`,
          findings,
          metrics: { modelCount: models.length, devOnlyCount },
        };
      }

      if (checkId === 'local-model-cache-status') {
        const bridge = getBridge();
        if (!bridge) {
          return {
            checkId,
            subsystem: 'models-assets',
            name: 'Installed Model Cache Integrity',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Electron localModels bridge is unavailable in browser dev mode; disk cache checks require desktop runtime.',
            findings: [],
          };
        }

        const cacheInfo = await inspectElectronCache();
        if (!cacheInfo) {
          return {
            checkId,
            subsystem: 'models-assets',
            name: 'Installed Model Cache Integrity',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Electron diagnostics cache inspection handler is unavailable.',
            findings: [],
          };
        }

        let installedCount = 0;
        let corruptCount = 0;
        let missingCount = 0;

        for (const st of cacheInfo.statuses) {
          if (st.state === 'installed') {
            installedCount++;
          } else if (st.state === 'corrupt') {
            corruptCount++;
            findings.push({
              findingId: `model-corrupt-${st.modelId}`,
              subsystem: 'models-assets',
              checkId,
              code: 'CORRUPT_LOCAL_MODEL',
              severity: 'error',
              title: `Local model "${st.modelId}" failed integrity check`,
              explanation: `Corrupt files: [${st.corruptFiles.join(', ')}]; missing files: [${st.missingFiles.join(', ')}].`,
              timestamp: Date.now(),
            });
          } else if (st.state === 'not_installed') {
            missingCount++;
            findings.push({
              findingId: `model-not-installed-${st.modelId}`,
              subsystem: 'models-assets',
              checkId,
              code: 'MODEL_NOT_INSTALLED',
              severity: 'warning',
              title: `Local model "${st.modelId}" is not installed`,
              explanation: `Routes requiring ${st.modelId} will fall back to Gemini until downloaded.`,
              timestamp: Date.now(),
            });
          } else if (st.state === 'unsupported') {
            findings.push({
              findingId: `model-unsupported-${st.modelId}`,
              subsystem: 'models-assets',
              checkId,
              code: 'MODEL_POLICY_UNSUPPORTED',
              severity: 'warning',
              title: `Local model "${st.modelId}" disallowed by policy`,
              explanation: st.error || 'Restricted by distribution policy.',
              timestamp: Date.now(),
            });
          }
        }

        return {
          checkId,
          subsystem: 'models-assets',
          name: 'Installed Model Cache Integrity',
          safety: 'read_only',
          status: corruptCount > 0 ? 'error' : missingCount > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Model cache inspected (${installedCount}/${cacheInfo.statuses.length} installed, ${corruptCount} corrupt, ${missingCount} not installed).`,
          findings,
          metrics: {
            modelsRootExists: cacheInfo.modelsRootExists,
            installedCount,
            corruptCount,
            missingCount,
          },
        };
      }

      if (checkId === 'ort-wasm-assets') {
        if (typeof window === 'undefined' || !fetchFn) {
          return {
            checkId,
            subsystem: 'models-assets',
            name: 'ONNX Runtime WASM Assets',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Renderer fetch unavailable in non-browser environment.',
            findings: [],
          };
        }

        const targets = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
        const missing: string[] = [];
        for (const file of targets) {
          try {
            const url = new URL(`./ort/${file}`, window.location.href).href;
            const res = await fetchFn(url, { method: 'HEAD' });
            if (!res.ok) missing.push(`${file} (HTTP ${res.status})`);
          } catch {
            missing.push(file);
          }
        }

        if (missing.length > 0) {
          findings.push({
            findingId: `ort-missing-${start}`,
            subsystem: 'models-assets',
            checkId,
            code: 'ORT_WASM_UNREACHABLE',
            severity: 'error',
            title: 'ONNX Runtime WASM asset probe failed',
            explanation: `Could not reach: ${missing.join(', ')}.`,
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'models-assets',
          name: 'ONNX Runtime WASM Assets',
          safety: 'read_only',
          status: missing.length > 0 ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary:
            missing.length === 0
              ? 'ONNX Runtime WASM scripts and binaries are reachable under /ort/.'
              : `Missing/unreachable ORT assets: ${missing.join(', ')}.`,
          findings,
          metrics: { probedFiles: targets.length, missingCount: missing.length },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on models-assets inspector.`);
    },
  };
}
