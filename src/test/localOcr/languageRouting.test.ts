import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LanguageRouteError,
  detectScriptSignal,
  resolveOcrLanguageRoute,
} from '../../lib/localOcr/languageRouter.ts';
import {
  LocalOcrEngineService,
  type WorkerLike,
} from '../../lib/localOcr/localOcrEngine.ts';
import type { LocalModelAssetProvider } from '../../lib/localOcr/modelClient.ts';
import type { ModelAssetPayload } from '../../types/localOcr.ts';
import type { SerializableLocalOcrResult, WorkerOcrRequest } from '../../lib/localOcr/workerProtocol.ts';

function fakeAssets(modelId: string): ModelAssetPayload {
  return {
    modelId,
    revisionLabel: 'rev0001',
    files:
      modelId === 'comic-detector-v4-s-int8'
        ? { 'detector-v4-s_int8.onnx': new Uint8Array([1]) }
        : {
            'det/inference.onnx': new Uint8Array([1]),
            'det/inference.yml': new TextEncoder().encode('Global:\n  model_name: t\n'),
            'rec/inference.onnx': new Uint8Array([1]),
            'rec/inference.yml': new TextEncoder().encode('Global:\n  model_name: t\n'),
          },
  };
}

function makeFakeResult(jobId: string, req: Extract<WorkerOcrRequest, { type: 'run_page_ocr' }>): SerializableLocalOcrResult {
  return {
    scanId: `local-${jobId}`,
    pageId: req.pageId,
    status: 'complete',
    sourceDimensions: { width: 400, height: 600 },
    readingConvention: 'ltr',
    languageHint: req.languageHint,
    resolvedRoute: req.resolvedRoute,
    bubbleRegions: [],
    textRegions: [],
    lineSegments: [],
    tiles: [],
    modelsUsed: {
      detectorModelId: 'comic-detector-v4-s-int8',
      detectorRevision: 'rev0001',
      ocrModelId: req.ocrAssets?.modelId ?? 'unknown',
      ocrRevision: 'rev0001',
      routeId: req.resolvedRoute,
      ocrRuntimeUsed: 'ort_web_adapter',
      executionProvider: 'wasm',
      simdEnabled: true,
      threadsUsed: 1,
    },
    timings: {
      initMs: 1,
      decodeMs: 1,
      detectorMs: 1,
      ocrMs: 1,
      postprocessMs: 0,
      totalMs: 4,
      tileCount: 1,
      cropCount: 0,
      measuredMemoryBytes: null,
    },
    partialFailures: [],
    warnings: [],
  };
}

test('P1.1: explicit language hints resolve deterministically and are never overridden by sampleText', () => {
  const en = resolveOcrLanguageRoute('en', '안녕하세요');
  assert.equal(en.status, 'resolved');
  assert.equal(en.hintKind, 'explicit');
  assert.equal(en.routeId, 'en_ppocrv6_small');
  assert.equal(en.effectiveLanguage, 'en');

  const ko = resolveOcrLanguageRoute('ko', 'Hello world');
  assert.equal(ko.status, 'resolved');
  assert.equal(ko.routeId, 'ko_ppocrv5_mobile');
  assert.equal(ko.effectiveLanguage, 'ko');

  const ja = resolveOcrLanguageRoute('ja', '漢字');
  assert.equal(ja.status, 'resolved');
  assert.equal(ja.routeId, 'ja_zh_ppocrv6_manga');
  assert.equal(ja.effectiveLanguage, 'ja');

  const zh = resolveOcrLanguageRoute('zh', '漢字');
  assert.equal(zh.status, 'resolved');
  assert.equal(zh.routeId, 'ja_zh_ppocrv6_manga');
  assert.equal(zh.effectiveLanguage, 'zh');
});

test('P1.1: automatic script detection handles Korean+Latin, Japanese Kana+Han, Latin, Han-only, and unknown safely', () => {
  // Mixed Hangul + Latin names/abbreviations (common in Korean manhwa)
  assert.equal(detectScriptSignal('김철수 VIP 레벨업!'), 'hangul');
  assert.equal(detectScriptSignal('HP 100 회복 - Level UP'), 'hangul');
  const koAuto = resolveOcrLanguageRoute('auto', '김철수 VIP 레벨업!');
  assert.equal(koAuto.status, 'resolved');
  assert.equal(koAuto.routeId, 'ko_ppocrv5_mobile');
  assert.equal(koAuto.effectiveLanguage, 'ko');
  assert.equal(koAuto.isAmbiguousAutoRoute, false);

  // Japanese with Kana + Han + Latin
  assert.equal(detectScriptSignal('そんなバカな！'), 'kana');
  assert.equal(detectScriptSignal('日本語のテスト LV.5'), 'kana');
  const jaAuto = resolveOcrLanguageRoute('auto', '日本語のテスト');
  assert.equal(jaAuto.status, 'resolved');
  assert.equal(jaAuto.routeId, 'ja_zh_ppocrv6_manga');
  assert.equal(jaAuto.effectiveLanguage, 'ja');

  // English / Latin
  assert.equal(detectScriptSignal('All right, fixed!'), 'latin');
  const enAuto = resolveOcrLanguageRoute('auto', 'All right, fixed!');
  assert.equal(enAuto.status, 'resolved');
  assert.equal(enAuto.routeId, 'en_ppocrv6_small');
  assert.equal(enAuto.effectiveLanguage, 'en');

  // Ambiguous Han-only text must NEVER silently pick Japanese vs Chinese
  assert.equal(detectScriptSignal('漢字世界'), 'han_only');
  const hanAuto = resolveOcrLanguageRoute('auto', '漢字世界');
  assert.equal(hanAuto.status, 'ambiguous');
  assert.equal(hanAuto.routeId, null);
  assert.equal(hanAuto.ocrModelId, null);
  assert.equal(hanAuto.isAmbiguousAutoRoute, true);
  assert.equal(hanAuto.requiresExplicitLanguageHint, true);

  // Empty or punctuation-only sampleText under 'auto' must NOT silently fall back to Manga
  for (const emptySample of [undefined, '', '   ', '12345 !?...']) {
    const undetermined = resolveOcrLanguageRoute('auto', emptySample);
    assert.equal(undetermined.status, 'undetermined');
    assert.equal(undetermined.routeId, null);
    assert.equal(undetermined.ocrModelId, null);
    assert.equal(undetermined.isAmbiguousAutoRoute, true);
    assert.equal(undetermined.requiresExplicitLanguageHint, true);
  }

  // Unsupported language hints must NOT silently fall back to 'auto' or Manga
  for (const badHint of ['fr', 'es', '', undefined]) {
    const bad = resolveOcrLanguageRoute(badHint as any);
    assert.equal(bad.status, 'unsupported');
    assert.equal(bad.routeId, null);
    assert.equal(bad.ocrModelId, null);
    assert.equal(bad.requiresExplicitLanguageHint, true);
  }
});

test('P1.1: actual engine entrypoint refuses silent Manga fallback for auto without evidence and routes valid cases accurately', async () => {
  const loadedModels: string[] = [];
  const workerRequests: WorkerOcrRequest[] = [];
  let workerCreatedCount = 0;

  const provider: LocalModelAssetProvider = {
    getManifest: async () => ({ manifestVersion: 1, models: [] }),
    getStatus: async () => [],
    downloadModel: async () => {
      throw new Error('unused');
    },
    cancelDownload: async () => false,
    removeModel: async () => {
      throw new Error('unused');
    },
    readModelAssets: async (modelId) => {
      loadedModels.push(modelId);
      return fakeAssets(modelId);
    },
  };

  const engine = new LocalOcrEngineService({
    modelProvider: provider,
    createWorker: (): WorkerLike => {
      workerCreatedCount++;
      const listeners = new Map<string, Set<(ev: any) => void>>();
      return {
        postMessage(msg) {
          workerRequests.push(msg);
          if (msg.type === 'run_page_ocr') {
            for (const fn of listeners.get('message') || []) {
              fn({
                data: {
                  type: 'job_result',
                  jobId: msg.jobId,
                  result: makeFakeResult(msg.jobId, msg),
                },
              });
            }
          }
        },
        addEventListener(t, fn) {
          if (!listeners.has(t)) listeners.set(t, new Set());
          listeners.get(t)!.add(fn);
        },
        removeEventListener(t, fn) {
          listeners.get(t)?.delete(fn);
        },
        terminate() {},
      };
    },
  });

  // 1. 'auto' without sampleText MUST reject clearly without loading Manga or spawning worker
  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        pageId: 'auto-empty',
        languageHint: 'auto',
      }),
    (err: unknown) => err instanceof LanguageRouteError && err.resolution.status === 'undetermined'
  );
  assert.equal(workerCreatedCount, 0);
  assert.equal(loadedModels.length, 0);

  // 2. 'auto' with ambiguous Han-only text MUST reject clearly
  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        pageId: 'auto-han',
        languageHint: 'auto',
        sampleText: '漢字',
      }),
    (err: unknown) => err instanceof LanguageRouteError && err.resolution.status === 'ambiguous'
  );
  assert.equal(workerCreatedCount, 0);

  // 3. Unsupported hint MUST reject clearly
  await assert.rejects(
    () =>
      engine.runPageOcr({
        image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        pageId: 'bad-hint',
        languageHint: 'fr' as any,
      }),
    (err: unknown) => err instanceof LanguageRouteError && err.resolution.status === 'unsupported'
  );
  assert.equal(workerCreatedCount, 0);

  // 4. 'auto' with mixed Hangul + Latin sampleText routes to Korean
  const koRes = await engine.runPageOcr({
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    pageId: 'auto-ko-mixed',
    languageHint: 'auto',
    sampleText: '김철수 VIP 레벨업',
  });
  assert.equal(koRes.resolvedRoute, 'ko_ppocrv5_mobile');
  assert.equal(koRes.modelsUsed.ocrModelId, 'ppocr-v5-mobile-ko');

  // 5. Explicit 'zh' routes to Manga v0.3 with effectiveLanguage='zh'
  const zhRes = await engine.runPageOcr({
    image: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    pageId: 'explicit-zh',
    languageHint: 'zh',
  });
  assert.equal(zhRes.resolvedRoute, 'ja_zh_ppocrv6_manga');
  const lastRunReq = workerRequests[workerRequests.length - 1];
  assert.ok(lastRunReq && lastRunReq.type === 'run_page_ocr');
  assert.equal(lastRunReq.effectiveLanguage, 'zh');
});
