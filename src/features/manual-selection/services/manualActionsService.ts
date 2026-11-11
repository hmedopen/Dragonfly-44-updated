import { create } from 'zustand';
import { createDefaultModelAssetProvider } from '../../../lib/localOcr/modelClient';
import { getPageBubbles } from '../../../services/db';
import { settingsService } from '../../../services/settings/settingsService';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import type { BubbleItem } from '../../../types/workbench';
import { computeGeometrySignature } from '../selection/geometry';
import { checkManualOcrModelReadiness, manualOcrService } from '../ocr/manualOcrService';
import { translateManualSelectionPages } from '../translation/manualTranslationService';
import type { OcrSupportedLanguage } from '../types/selection';

export type ManualOperationPhase =
  | 'ready'
  | 'drawing'
  | 'extracting'
  | 'extraction_completed'
  | 'extraction_failed'
  | 'translating'
  | 'translation_completed'
  | 'translation_failed'
  | 'cancelled';

export interface ManualControllerState {
  phase: ManualOperationPhase;
  statusMessage: string;
  errorMessage: string | null;
  missingModelInfo: {
    modelId: string;
    canDownload: boolean;
    downloading: boolean;
    message: string;
  } | null;
  progress: { completed: number; total: number } | null;
  ocrLanguage: OcrSupportedLanguage;
  isDrawing: boolean;
  setDrawing: (drawing: boolean) => void;
  setOcrLanguage: (lang: OcrSupportedLanguage) => void;
  syncLanguageFromSettings: (projectId?: string | null, chapterId?: string | null) => void;
  clearError: () => void;
  downloadMissingModel: () => Promise<void>;
  extractPage: (pageId: string) => Promise<void>;
  extractAll: (pages: Array<{ id: string; index: number }>) => Promise<void>;
  cancelOcr: () => void;
  translatePage: (
    projectId: string | null,
    chapterId: string | null,
    pages: Array<{ id: string; index: number }>,
    activePageId: string
  ) => Promise<void>;
  translateAll: (
    projectId: string | null,
    chapterId: string | null,
    pages: Array<{ id: string; index: number }>,
    onlyFailed?: boolean
  ) => Promise<void>;
  cancelTranslation: () => void;
}

function resolveInitialManualOcrLanguage(
  projectId?: string | null,
  chapterId?: string | null
): OcrSupportedLanguage {
  const globalSrc = settingsService.getEffectiveValue<string>('scanning.source_language', {
    projectId,
    chapterId,
  }).value;
  if (globalSrc === 'en' || globalSrc === 'ja' || globalSrc === 'zh' || globalSrc === 'ko') {
    return globalSrc;
  }
  const manualPref = settingsService.getEffectiveValue<string>('manual_selection.ocr_language', {
    projectId,
    chapterId,
  }).value;
  if (manualPref === 'en' || manualPref === 'ja' || manualPref === 'zh' || manualPref === 'ko') {
    return manualPref;
  }
  return 'ja';
}

let activeOcrAbort: AbortController | null = null;
let activeTransAbort: AbortController | null = null;

function patchSingleBubbleInPage(
  pageId: string,
  bubbleId: string,
  patch: Partial<BubbleItem>,
  persist = true
): void {
  const wb = useWorkbenchStore.getState();
  const list = wb.bubblesByPage[pageId];
  if (!list) return;
  const next = list.map((b) => (b.id === bubbleId ? { ...b, ...patch } : b));
  wb.setPageBubblesDirect(pageId, next, persist);
}

export const useManualControllerStore = create<ManualControllerState>((set, get) => ({
  phase: 'ready',
  statusMessage: 'Ready',
  errorMessage: null,
  missingModelInfo: null,
  progress: null,
  ocrLanguage: resolveInitialManualOcrLanguage(),
  isDrawing: false,

  setDrawing: (drawing) =>
    set((s) => {
      if (s.phase === 'extracting' || s.phase === 'translating') {
        return { isDrawing: drawing };
      }
      return {
        isDrawing: drawing,
        phase: drawing ? 'drawing' : 'ready',
        statusMessage: drawing ? 'Drawing selection' : 'Ready',
      };
    }),

  setOcrLanguage: (lang) => {
    settingsService.setSettingValue('manual_selection.ocr_language', lang, { scope: 'global' });
    set({ ocrLanguage: lang, missingModelInfo: null, errorMessage: null });
  },

  syncLanguageFromSettings: (projectId, chapterId) => {
    const resolved = resolveInitialManualOcrLanguage(projectId, chapterId);
    set({ ocrLanguage: resolved });
  },

  clearError: () => set({ errorMessage: null, missingModelInfo: null }),

  downloadMissingModel: async () => {
    const info = get().missingModelInfo;
    if (!info || !info.modelId) return;
    const provider = createDefaultModelAssetProvider();
    if (!provider) return;

    set((s) => ({
      missingModelInfo: s.missingModelInfo ? { ...s.missingModelInfo, downloading: true } : null,
      statusMessage: `Downloading ${info.modelId}...`,
    }));

    try {
      await provider.downloadModel(info.modelId);
      set({
        missingModelInfo: null,
        errorMessage: null,
        phase: 'ready',
        statusMessage: 'Model ready',
      });
    } catch (err: any) {
      set((s) => ({
        missingModelInfo: s.missingModelInfo
          ? {
              ...s.missingModelInfo,
              downloading: false,
              message: err?.message || 'Model download failed.',
            }
          : null,
        phase: 'extraction_failed',
        errorMessage: err?.message || 'Model download failed.',
        statusMessage: 'Model download failed',
      }));
    }
  },

  extractPage: async (pageId) => {
    const wb = useWorkbenchStore.getState();
    const pageBubbles = wb.bubblesByPage[pageId] || (await getPageBubbles(pageId));
    const manualBubbles = pageBubbles.filter((b) => b.provenance === 'manual_selection');

    if (manualBubbles.length === 0) {
      set({
        phase: 'ready',
        statusMessage: 'No manual selections on this page',
        errorMessage: null,
      });
      return;
    }

    const pending = manualBubbles.filter((b) => {
      if (b.manualExtractionStatus === 'manual_text') return false;
      const sig = computeGeometrySignature(b.box_2d, b.manualPolygon);
      if (
        b.manualExtractionStatus === 'ocr_success' &&
        b.manualExtractedGeometrySignature === sig
      ) {
        return false;
      }
      return true;
    });

    const targets =
      pending.length > 0
        ? pending
        : manualBubbles.filter((b) => b.manualExtractionStatus !== 'manual_text');

    if (targets.length === 0) {
      set({
        phase: 'extraction_completed',
        statusMessage: 'All selections preserved (manual text)',
        errorMessage: null,
      });
      return;
    }

    const lang = get().ocrLanguage;
    const readiness = await checkManualOcrModelReadiness(lang);
    if (!readiness.ready) {
      const msg = readiness.error || 'Required local OCR model is unavailable.';
      set({
        phase: 'extraction_failed',
        statusMessage: 'Extraction failed',
        errorMessage: msg,
        missingModelInfo: {
          modelId: readiness.ocrModelId,
          canDownload: Boolean(readiness.canDownload),
          downloading: false,
          message: msg,
        },
      });
      return;
    }

    activeOcrAbort?.abort();
    const controller = new AbortController();
    activeOcrAbort = controller;

    set({
      phase: 'extracting',
      statusMessage: `Extracting (0/${targets.length})`,
      errorMessage: null,
      missingModelInfo: null,
      progress: { completed: 0, total: targets.length },
    });

    const targetIds = new Set(targets.map((t) => t.id));
    wb.setPageBubblesDirect(
      pageId,
      pageBubbles.map((b) =>
        targetIds.has(b.id)
          ? { ...b, manualExtractionStatus: 'ocr_running', manualExtractionError: null }
          : b
      ),
      false
    );

    try {
      const res = await manualOcrService.extractPageRegions({
        pageId,
        bubbles: targets,
        language: lang,
        signal: controller.signal,
        onProgress: (_regionId, completed, total) => {
          set({
            statusMessage: `Extracting (${completed}/${total})`,
            progress: { completed, total },
          });
        },
      });

      const outcomeMap = new Map(res.outcomes.map((o) => [o.regionId, o]));
      const latestPageBubbles = useWorkbenchStore.getState().bubblesByPage[pageId] || pageBubbles;
      const now = Date.now();
      let succeeded = 0;
      let failed = 0;

      const updatedList = latestPageBubbles.map((b) => {
        const outcome = outcomeMap.get(b.id);
        if (!outcome) return b;
        if (outcome.status === 'ocr_success' || outcome.status === 'ocr_partial') succeeded++;
        else failed++;

        const sig = computeGeometrySignature(b.box_2d, b.manualPolygon);
        const nextText = outcome.status === 'ocr_failed' && b.sourceText ? b.sourceText : outcome.text;
        return {
          ...b,
          sourceText: nextText,
          originalSourceText:
            outcome.status === 'ocr_failed' && b.originalSourceText ? b.originalSourceText : nextText,
          sourceLanguage: lang,
          confidence: outcome.confidence,
          manualExtractionStatus: outcome.status,
          manualExtractionError: outcome.error ?? null,
          manualExtractedGeometrySignature: sig,
          updatedAt: now,
        };
      });

      useWorkbenchStore.getState().setPageBubblesDirect(pageId, updatedList, true);

      set({
        phase: failed > 0 && succeeded === 0 ? 'extraction_failed' : 'extraction_completed',
        statusMessage:
          failed > 0
            ? `Extracted ${succeeded}, ${failed} failed`
            : `Extraction completed (${succeeded})`,
        errorMessage: failed > 0 && succeeded === 0 ? 'No text detected in selected regions.' : null,
        progress: null,
      });
    } catch (err: any) {
      const cancelled = controller.signal.aborted || err?.name === 'AbortError';
      const msg = cancelled ? 'Extraction cancelled' : err?.message || String(err);
      const latestPageBubbles = useWorkbenchStore.getState().bubblesByPage[pageId] || pageBubbles;

      useWorkbenchStore.getState().setPageBubblesDirect(
        pageId,
        latestPageBubbles.map((b) =>
          targetIds.has(b.id)
            ? {
                ...b,
                manualExtractionStatus: cancelled ? 'ocr_pending' : 'ocr_failed',
                manualExtractionError: cancelled ? null : msg,
              }
            : b
        ),
        true
      );

      set({
        phase: cancelled ? 'cancelled' : 'extraction_failed',
        statusMessage: cancelled ? 'Cancelled' : 'Extraction failed',
        errorMessage: cancelled ? null : msg,
        progress: null,
      });
    }
  },

  extractAll: async (pages) => {
    const lang = get().ocrLanguage;
    const readiness = await checkManualOcrModelReadiness(lang);
    if (!readiness.ready) {
      const msg = readiness.error || 'Required local OCR model is unavailable.';
      set({
        phase: 'extraction_failed',
        statusMessage: 'Extraction failed',
        errorMessage: msg,
        missingModelInfo: {
          modelId: readiness.ocrModelId,
          canDownload: Boolean(readiness.canDownload),
          downloading: false,
          message: msg,
        },
      });
      return;
    }

    activeOcrAbort?.abort();
    const controller = new AbortController();
    activeOcrAbort = controller;

    set({
      phase: 'extracting',
      statusMessage: 'Extracting chapter selections...',
      errorMessage: null,
      missingModelInfo: null,
      progress: null,
    });

    const summary = await manualOcrService.extractChapterSelections({
      pages,
      language: lang,
      bubblesByPage: useWorkbenchStore.getState().bubblesByPage,
      signal: controller.signal,
      onRegionRunning: (pageId, bubbleId) => {
        patchSingleBubbleInPage(
          pageId,
          bubbleId,
          { manualExtractionStatus: 'ocr_running', manualExtractionError: null },
          false
        );
      },
      onPageProgress: (_completedPages, _totalPages, pageIndex) => {
        set((s) => ({
          statusMessage: `Extracting Page ${pageIndex}...`,
          progress: s.progress,
        }));
      },
      onRegionProgress: (completed, total) => {
        set({
          statusMessage: `Extracting (${completed}/${total})`,
          progress: { completed, total },
        });
      },
      onPageComplete: async (pageId, updatedBubbles) => {
        useWorkbenchStore.getState().setPageBubblesDirect(pageId, updatedBubbles, true);
      },
    });

    if (summary.cancelled) {
      set({ phase: 'cancelled', statusMessage: 'Extraction cancelled', progress: null });
      return;
    }

    if (summary.processedPages === 0 && summary.failedRegions === 0 && !summary.fatalError) {
      set({
        phase: 'ready',
        statusMessage: 'No pending manual selections in chapter',
        progress: null,
      });
      return;
    }

    const totalOk = summary.succeededRegions + summary.partialRegions;
    set({
      phase: summary.fatalError || (summary.failedRegions > 0 && totalOk === 0)
        ? 'extraction_failed'
        : 'extraction_completed',
      statusMessage:
        summary.failedRegions > 0
          ? `Extracted ${totalOk}, ${summary.failedRegions} failed`
          : `Extraction completed (${totalOk})`,
      errorMessage: summary.fatalError,
      progress: null,
    });
  },

  cancelOcr: () => {
    activeOcrAbort?.abort();
  },

  translatePage: async (projectId, chapterId, pages, activePageId) => {
    const wb = useWorkbenchStore.getState();
    const list = wb.bubblesByPage[activePageId] || (await getPageBubbles(activePageId));
    const map = new Map<string, BubbleItem[]>([[activePageId, list]]);

    activeTransAbort?.abort();
    const controller = new AbortController();
    activeTransAbort = controller;

    set({
      phase: 'translating',
      statusMessage: 'Translating page...',
      errorMessage: null,
      progress: null,
    });

    const result = await translateManualSelectionPages({
      projectId,
      chapterId,
      pages,
      bubblesByPage: map,
      targetPageIds: [activePageId],
      signal: controller.signal,
      onRegionResult: async (pageId, bubble, outcome) => {
        const latest = useWorkbenchStore.getState().bubblesByPage[pageId] || list;
        const next = latest.map((b) => {
          if (b.id !== bubble.id) return b;
          if (outcome.status === 'translated') {
            return {
              ...b,
              translatedText: outcome.humanizedText,
              rawTranslatedText: outcome.rawText,
              humanizedTranslatedText: outcome.humanizedText,
              manualTranslationStatus: 'translated' as const,
              manualTranslationError: null,
              updatedAt: Date.now(),
            };
          }
          return {
            ...b,
            manualTranslationStatus: 'translation_failed' as const,
            manualTranslationError: outcome.error,
            updatedAt: Date.now(),
          };
        });
        useWorkbenchStore.getState().setPageBubblesDirect(pageId, next, true);
      },
      onProgress: (completed, total) => {
        set({
          statusMessage: `Translating (${completed}/${total})`,
          progress: { completed, total },
        });
      },
    });

    if (result.cancelled) {
      set({ phase: 'cancelled', statusMessage: 'Translation cancelled', progress: null });
      return;
    }

    if (result.totalRequested === 0) {
      set({
        phase: 'ready',
        statusMessage: 'No extracted manual text to translate on page',
        progress: null,
      });
      return;
    }

    set({
      phase: result.failedCount > 0 && result.translatedCount === 0 ? 'translation_failed' : 'translation_completed',
      statusMessage:
        result.failedCount > 0
          ? `Translated ${result.translatedCount}, ${result.failedCount} failed`
          : `Translation completed (${result.translatedCount})`,
      errorMessage:
        result.fatalError ||
        (result.failedCount > 0 ? `${result.failedCount} selection(s) failed translation.` : null),
      progress: null,
    });
  },

  translateAll: async (projectId, chapterId, pages, onlyFailed = false) => {
    const wb = useWorkbenchStore.getState();
    const map = new Map<string, BubbleItem[]>();
    for (const p of pages) {
      const existing = wb.bubblesByPage[p.id];
      const list = existing && existing.length > 0 ? existing : await getPageBubbles(p.id);
      if (list.length > 0) {
        map.set(p.id, list);
      }
    }

    activeTransAbort?.abort();
    const controller = new AbortController();
    activeTransAbort = controller;

    set({
      phase: 'translating',
      statusMessage: onlyFailed ? 'Retrying failed translations...' : 'Translating chapter selections...',
      errorMessage: null,
      progress: null,
    });

    const result = await translateManualSelectionPages({
      projectId,
      chapterId,
      pages,
      bubblesByPage: map,
      targetPageIds: pages.map((p) => p.id),
      onlyFailed,
      signal: controller.signal,
      onPageStart: (_pid, pageIndex) => {
        set({ statusMessage: `Translating Page ${pageIndex}...` });
      },
      onRegionResult: async (pageId, bubble, outcome) => {
        const current = useWorkbenchStore.getState().bubblesByPage[pageId] || map.get(pageId) || [];
        const next = current.map((b) => {
          if (b.id !== bubble.id) return b;
          if (outcome.status === 'translated') {
            return {
              ...b,
              translatedText: outcome.humanizedText,
              rawTranslatedText: outcome.rawText,
              humanizedTranslatedText: outcome.humanizedText,
              manualTranslationStatus: 'translated' as const,
              manualTranslationError: null,
              updatedAt: Date.now(),
            };
          }
          return {
            ...b,
            manualTranslationStatus: 'translation_failed' as const,
            manualTranslationError: outcome.error,
            updatedAt: Date.now(),
          };
        });
        map.set(pageId, next);
        useWorkbenchStore.getState().setPageBubblesDirect(pageId, next, true);
      },
      onProgress: (completed, total) => {
        set({
          statusMessage: `Translating (${completed}/${total})`,
          progress: { completed, total },
        });
      },
    });

    if (result.cancelled) {
      set({ phase: 'cancelled', statusMessage: 'Translation cancelled', progress: null });
      return;
    }

    if (result.totalRequested === 0) {
      set({
        phase: 'ready',
        statusMessage: onlyFailed ? 'No failed translations to retry' : 'No extracted manual text to translate',
        progress: null,
      });
      return;
    }

    set({
      phase: result.failedCount > 0 && result.translatedCount === 0 ? 'translation_failed' : 'translation_completed',
      statusMessage:
        result.failedCount > 0
          ? `Translated ${result.translatedCount}, ${result.failedCount} failed`
          : `Translation completed (${result.translatedCount})`,
      errorMessage:
        result.fatalError ||
        (result.failedCount > 0 ? `${result.failedCount} selection(s) failed translation.` : null),
      progress: null,
    });
  },

  cancelTranslation: () => {
    activeTransAbort?.abort();
  },
}));
