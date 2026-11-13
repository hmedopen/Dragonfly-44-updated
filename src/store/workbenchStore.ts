import { create } from 'zustand';
import type { 
  BubbleItem, 
  PageScanStatus, 
  ProjectLoreLedger, 
  ChapterIntelligence,
  EloquenceLevel, 
  GeminiModelKey,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode
} from '../types/workbench';
import { loadTyperSettings, resolveCanonicalTyper, resolveTyperVisual } from '../types/typers';
import { computeGeometrySignature } from '../features/manual-selection/selection/geometry';
import type { SelectionMode, NormalizedBox2D, NormalizedPolygon } from '../features/manual-selection/types/selection';
import { getPageBubbles, savePageBubbles, getProjectLore, updateReviewFindingStatus } from '../services/db';
import { getChapterIntelligence } from '../services/intelligence';
import { projectMemory } from '../services/projectMemory';
import type { KnowledgeCandidate, KnowledgeConflictSet } from '../types/memory';
import { scanQueue } from '../lib/scanQueue';
import { auditChapterWithGemini } from '../lib/reviewEngine';
import { translateSingleBubbleWithGemini, interpretPageVisualContext } from '../lib/geminiScan';
import { settingsService } from '../services/settings/settingsService';

let unsubscribeBatchScanQueue: (() => void) | null = null;

export type CurrentView = 'hub' | 'workbench';
export type ViewportMode = 'manga-flip' | 'webtoon-strip';
export type FeedFilterMode = 'all' | 'flagged';

interface WorkbenchState {
  currentView: CurrentView;
  activeFolderId: string | null;
  activeChapterId: string | null;
  activePageId: string | null;
  viewportMode: ViewportMode;
  selectedBubbleId: string | null;
  bubblesByPage: Record<string, BubbleItem[]>;
  projectLore: ProjectLoreLedger | null;
  chapterIntelligence: ChapterIntelligence | null;
  memoryCandidates: KnowledgeCandidate[];
  memoryConflicts: KnowledgeConflictSet[];

  // Tool & Drawer toggles
  isSettingsOpen: boolean;
  isKeyboardOpen: boolean;
  isManualSelectionOpen: boolean;
  manualSelectionMode: SelectionMode;
  manualSelectedTyperId: string;
  isTypeRModalOpen: boolean;
  isDrawBoxActive: boolean;
  isUtilityRailExpanded: boolean;
  zoomLevel: number;
  feedFilter: FeedFilterMode;

  // Scan Queue & Realtime Page Status
  isScanningActive: boolean;
  scanProgressText: string | null;
  pageStatuses: Record<string, PageScanStatus>;
  detailedPageStatuses: Record<string, PageScanStatus>;
  isReviewingChapter: boolean;
  isScanningSinglePage: boolean;
  isReviewingSinglePage: boolean;

  // Navigation & Lifecycle Actions
  setCurrentView: (view: CurrentView) => void;
  openChapter: (chapterId: string, folderId?: string | null, pageId?: string | null) => void;
  setActiveChapterId: (chapterId: string | null) => void;
  setActiveFolderId: (folderId: string | null) => void;
  setActivePageId: (pageId: string | null) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setSelectedBubbleId: (bubbleId: string | null) => void;
  returnToHub: () => void;

  // Tool & Drawer Actions
  setIsSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setIsKeyboardOpen: (open: boolean) => void;
  toggleKeyboard: () => void;
  setIsManualSelectionOpen: (open: boolean) => void;
  toggleManualSelection: () => void;
  setManualSelectionMode: (mode: SelectionMode) => void;
  setManualSelectedTyperId: (typerId: string) => void;
  setIsTypeRModalOpen: (open: boolean) => void;
  toggleTypeRModal: () => void;
  setIsDrawBoxActive: (active: boolean) => void;
  toggleDrawBox: () => void;
  setIsUtilityRailExpanded: (expanded: boolean) => void;
  toggleUtilityRail: () => void;
  setZoomLevel: (zoom: number) => void;
  resetZoom: () => void;
  setFeedFilter: (filter: FeedFilterMode) => void;

  // Bubble manipulation actions (with edit protection & flag lifecycle)
  loadPageBubbles: (pageId: string) => Promise<void>;
  setPageBubblesDirect: (pageId: string, bubbles: BubbleItem[], persist?: boolean) => void;
  addManualBubble: (pageId: string, initialBox?: [number, number, number, number]) => void;
  addManualSelectionRecord: (
    pageId: string,
    input: {
      shape: SelectionMode;
      box_2d: NormalizedBox2D;
      polygon?: NormalizedPolygon;
      typerId?: string;
    }
  ) => BubbleItem;
  updateManualSelectionGeometry: (
    pageId: string,
    bubbleId: string,
    next: { box_2d: NormalizedBox2D; polygon?: NormalizedPolygon }
  ) => void;
  clearManualSelections: (
    scope: 'page' | 'chapter',
    pageId: string | null,
    chapterPageIds: string[]
  ) => Promise<number>;
  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => void;
  deleteBubble: (pageId: string, bubbleId: string) => void;
  reorderBubbles: (pageId: string, startIndex: number, endIndex: number) => void;
  splitBubble: (
    pageId: string,
    bubbleId: string,
    splitIndex: number,
    field?: 'sourceText' | 'translatedText'
  ) => void;
  transferText: (
    pageId: string,
    params: {
      sourceBubbleId: string;
      sourceField: 'sourceText' | 'translatedText';
      sourceStart: number;
      sourceEnd: number;
      destBubbleId: string;
      destField: 'sourceText' | 'translatedText';
      dropPos: number;
      transferredText: string;
    }
  ) => void;
  undoBubbleAction: (pageId: string) => void;
  redoBubbleAction: (pageId: string) => void;
  bubbleUndoStack: Record<string, BubbleItem[][]>;
  bubbleRedoStack: Record<string, BubbleItem[][]>;
  acceptFlag: (pageId: string, bubbleId: string, flagId: string) => void;
  dismissFlag: (pageId: string, bubbleId: string, flagId: string) => void;
  revertSourceText: (pageId: string, bubbleId: string) => void;
  revertTranslatedText: (pageId: string, bubbleId: string) => void;
  revertToRawTranslation: (pageId: string, bubbleId: string) => void;
  revertToHumanizedTranslation: (pageId: string, bubbleId: string) => void;
  reconcileActiveSFXState: (includeSFX: boolean) => Promise<void>;

  // Four Core AI Operations
  startBatchScan: (
    pages: { pageId: string; pageIndex: number }[],
    projectId?: string | null,
    isDraft?: boolean
  ) => void;
  cancelBatchScan: () => void;
  scanSinglePage: (
    pageId: string,
    pageIndex: number,
    projectId?: string | null,
    isDraft?: boolean
  ) => void;
  interpretSinglePage: (
    pageId: string,
    projectId?: string | null
  ) => Promise<any>;
  translateSingleBubble: (
    pageId: string,
    bubbleId: string,
    projectId?: string | null,
    isDraft?: boolean
  ) => Promise<void>;
  runChapterReview: (
    chapterId: string,
    pages: { pageId: string; pageIndex: number }[],
    projectId?: string | null,
    isDraft?: boolean
  ) => Promise<void>;
  loadMemoryCandidates: (projectId: string) => Promise<void>;
  approveMemoryCandidate: (candidateId: string) => Promise<void>;
  rejectMemoryCandidate: (candidateId: string, reason?: string) => Promise<void>;
  resolveMemoryConflict: (conflictId: string, decision: string, value: any) => Promise<void>;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  currentView: 'hub',
  activeFolderId: null,
  activeChapterId: null,
  activePageId: null,
  viewportMode: 'manga-flip',
  selectedBubbleId: null,
  bubblesByPage: {},
  bubbleUndoStack: {},
  bubbleRedoStack: {},
  projectLore: null,
  chapterIntelligence: null,
  memoryCandidates: [],
  memoryConflicts: [],

  // Modals & Panels
  isSettingsOpen: false,
  isKeyboardOpen: false,
  isManualSelectionOpen: false,
  manualSelectionMode: (() => {
    const val = settingsService.getEffectiveValue<string>('manual_selection.last_selection_mode').value;
    return val === 'bubble' || val === 'lasso' ? val : 'box';
  })(),
  manualSelectedTyperId:
    settingsService.getEffectiveValue<string>('manual_selection.last_typer_id').value || 'speech_bubbles',
  isTypeRModalOpen: false,
  isDrawBoxActive: false,
  isUtilityRailExpanded: false,
  zoomLevel: 100,
  feedFilter: 'all',

  // Real-time Queue & Audit State
  isScanningActive: false,
  scanProgressText: null,
  pageStatuses: {},
  detailedPageStatuses: {},
  isReviewingChapter: false,
  isScanningSinglePage: false,
  isReviewingSinglePage: false,

  setCurrentView: (view) => set({ currentView: view }),

  openChapter: (chapterId, folderId = null, pageId = null) => {
    set((state) => ({
      activeChapterId: chapterId,
      activeFolderId: folderId ?? state.activeFolderId,
      activePageId: pageId,
      currentView: 'workbench',
      selectedBubbleId: null,
    }));

    // Hydrate Project Lore and Chapter Intelligence
    if (folderId && folderId !== 'folder-drafts') {
      getProjectLore(folderId)
        .then((lore) => {
          set({ projectLore: lore });
        })
        .catch((err) => {
          console.warn('[WorkbenchStore] Failed to hydrate project lore:', err);
        });
      get().loadMemoryCandidates(folderId);
    } else {
      set({ projectLore: null, memoryCandidates: [], memoryConflicts: [] });
    }

    getChapterIntelligence(chapterId)
      .then((intel: ChapterIntelligence | null) => {
        set({ chapterIntelligence: intel });
      })
      .catch((err) => {
        console.warn('[WorkbenchStore] Failed to hydrate chapter intelligence:', err);
      });
  },

  setActiveChapterId: (chapterId) => set({ activeChapterId: chapterId }),
  setActiveFolderId: (folderId) => set({ activeFolderId: folderId }),
  setActivePageId: (pageId) => set({ activePageId: pageId, selectedBubbleId: null }),
  setViewportMode: (mode) => set({ viewportMode: mode }),
  setSelectedBubbleId: (bubbleId) => set({ selectedBubbleId: bubbleId }),

  returnToHub: () =>
    set({
      currentView: 'hub',
      activePageId: null,
      selectedBubbleId: null,
      isSettingsOpen: false,
      isKeyboardOpen: false,
      isManualSelectionOpen: false,
      isTypeRModalOpen: false,
    }),

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setIsKeyboardOpen: (open) => set({ isKeyboardOpen: open }),
  toggleKeyboard: () => set((s) => ({ isKeyboardOpen: !s.isKeyboardOpen })),
  setIsManualSelectionOpen: (open) =>
    set({
      isManualSelectionOpen: open,
      ...(open ? { isDrawBoxActive: false } : {}),
    }),
  toggleManualSelection: () =>
    set((s) => {
      const next = !s.isManualSelectionOpen;
      return {
        isManualSelectionOpen: next,
        ...(next ? { isDrawBoxActive: false } : {}),
      };
    }),
  setManualSelectionMode: (mode) => {
    settingsService.setSettingValue('manual_selection.last_selection_mode', mode, { scope: 'global' });
    set({ manualSelectionMode: mode });
  },
  setManualSelectedTyperId: (typerId) => {
    settingsService.setSettingValue('manual_selection.last_typer_id', typerId, { scope: 'global' });
    set({ manualSelectedTyperId: typerId });
  },
  setIsTypeRModalOpen: (open) => set({ isTypeRModalOpen: open }),
  toggleTypeRModal: () => set((s) => ({ isTypeRModalOpen: !s.isTypeRModalOpen })),
  setIsDrawBoxActive: (active) => set({ isDrawBoxActive: active }),
  toggleDrawBox: () => set((s) => ({ isDrawBoxActive: !s.isDrawBoxActive })),
  setIsUtilityRailExpanded: (expanded) => set({ isUtilityRailExpanded: expanded }),
  toggleUtilityRail: () => set((s) => ({ isUtilityRailExpanded: !s.isUtilityRailExpanded })),
  setZoomLevel: (zoom) => set({ zoomLevel: Math.max(25, Math.min(zoom, 1000)) }),
  resetZoom: () => set({ zoomLevel: 100 }),
  setFeedFilter: (filter) => set({ feedFilter: filter }),

  loadPageBubbles: async (pageId: string) => {
    try {
      const storedBubbles = await getPageBubbles(pageId);
      const bubblesToSet: BubbleItem[] =
        storedBubbles && storedBubbles.length > 0
          ? storedBubbles.map((b, idx) => ({ ...b, index: idx + 1 }))
          : [];

      set((state) => ({
        bubblesByPage: {
          ...state.bubblesByPage,
          [pageId]: bubblesToSet,
        },
      }));
    } catch (err) {
      console.error('[WorkbenchStore] Failed to load bubbles from IndexedDB', err);
      set((state) => ({
        bubblesByPage: {
          ...state.bubblesByPage,
          [pageId]: [],
        },
      }));
    }
  },

  setPageBubblesDirect: (pageId: string, bubbles: BubbleItem[], persist = true) => {
    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: bubbles,
      },
    }));
    if (persist) {
      savePageBubbles(pageId, bubbles).catch((err) =>
        console.error('[WorkbenchStore] Failed to persist page bubbles to IDB', err)
      );
    }
  },

  addManualBubble: (pageId: string, initialBox?: [number, number, number, number]) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const maxIndex = existing.reduce((max, b) => Math.max(max, b.index || 0), 0);
    const nextIndex = maxIndex + 1;

    const typerSettings = loadTyperSettings();
    const defaultSpeechTyper = typerSettings.typers.find(
      (t) => t.id === 'speech_bubbles' || t.name.toLowerCase() === 'speech bubbles'
    );
    const initialType = defaultSpeechTyper ? defaultSpeechTyper.id : (typerSettings.typers[0]?.id || 'none');
    const initialPrefix = defaultSpeechTyper ? defaultSpeechTyper.prefix : (typerSettings.typers[0]?.prefix || '');
    const visual = resolveTyperVisual({ type: initialType, typerPrefix: initialPrefix }, typerSettings.typers);

    const newBubble: BubbleItem = {
      id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pageId,
      chapterId: state.activeChapterId || undefined,
      index: nextIndex,
      box_2d: initialBox || [350, 250, 550, 650],
      type: initialType,
      typerPrefix: initialPrefix,
      manualColorSnapshot: visual.isClassified ? visual.color : undefined,
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      isManuallyEdited: true,
      updatedAt: Date.now(),
    };

    const updated = [...existing, newBubble];
    const pageUndo = (state.bubbleUndoStack[pageId] || []).slice(-39);

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
      selectedBubbleId: newBubble.id,
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to save manual bubble to IDB', err)
    );
  },

  addManualSelectionRecord: (pageId, input) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const maxIndex = existing.reduce((max, b) => Math.max(max, b.index || 0), 0);
    const nextIndex = maxIndex + 1;

    const typerSettings = loadTyperSettings();
    const targetTyperId = input.typerId || state.manualSelectedTyperId;
    const matchedTyper =
      typerSettings.typers.find((t) => t.id === targetTyperId) ||
      typerSettings.typers.find((t) => t.id === 'speech_bubbles') ||
      typerSettings.typers[0];

    const initialType = matchedTyper ? matchedTyper.id : 'none';
    const initialPrefix = matchedTyper ? matchedTyper.prefix : '';
    const visual = resolveTyperVisual(
      { type: initialType, typerPrefix: initialPrefix, manualColorSnapshot: matchedTyper?.color },
      typerSettings.typers
    );

    const newBubble: BubbleItem = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pageId,
      chapterId: state.activeChapterId || undefined,
      index: nextIndex,
      box_2d: input.box_2d,
      type: initialType,
      typerPrefix: initialPrefix,
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      isManuallyEdited: false,
      updatedAt: Date.now(),
      provenance: 'manual_selection',
      manualSelectionShape: input.shape,
      ...(input.polygon && input.polygon.length >= 3 ? { manualPolygon: input.polygon } : {}),
      manualColorSnapshot: visual.isClassified ? visual.color : undefined,
      manualExtractionStatus: 'created',
      manualExtractionError: null,
      manualTranslationStatus: 'untranslated',
      manualTranslationError: null,
    };

    const updated = [...existing, newBubble];
    const pageUndo = (state.bubbleUndoStack[pageId] || []).slice(-39);

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
      selectedBubbleId: newBubble.id,
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to save manual selection record to IDB', err)
    );

    return newBubble;
  },

  updateManualSelectionGeometry: (pageId, bubbleId, next) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const target = existing.find((b) => b.id === bubbleId);
    if (!target) return;

    const newSig = computeGeometrySignature(next.box_2d, next.polygon);
    const prevSig = computeGeometrySignature(target.box_2d, target.manualPolygon);
    if (newSig === prevSig) return;

    const pageUndo = (state.bubbleUndoStack[pageId] || []).slice(-39);
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const geometryChangedAfterExtract =
        Boolean(b.manualExtractedGeometrySignature) &&
        b.manualExtractedGeometrySignature !== newSig;
      return {
        ...b,
        box_2d: next.box_2d,
        ...(next.polygon ? { manualPolygon: next.polygon } : {}),
        ...(geometryChangedAfterExtract && b.manualExtractionStatus !== 'manual_text'
          ? { manualExtractionStatus: 'ocr_pending' as const }
          : {}),
        updatedAt: Date.now(),
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to persist updated selection geometry to IDB', err)
    );
  },

  clearManualSelections: async (scope, pageId, chapterPageIds) => {
    const state = get();
    if (scope === 'page') {
      if (!pageId) return 0;
      const existing = state.bubblesByPage[pageId] || [];
      const manualCount = existing.filter((b) => b.provenance === 'manual_selection').length;
      if (manualCount === 0) return 0;

      const surviving = existing
        .filter((b) => b.provenance !== 'manual_selection')
        .map((b, idx) => ({ ...b, index: idx + 1 }));
      const selectedRemoved = Boolean(
        state.selectedBubbleId &&
          existing.some(
            (b) => b.id === state.selectedBubbleId && b.provenance === 'manual_selection'
          )
      );
      const pageUndo = (state.bubbleUndoStack[pageId] || []).slice(-39);

      set((s) => ({
        bubblesByPage: {
          ...s.bubblesByPage,
          [pageId]: surviving,
        },
        selectedBubbleId: selectedRemoved ? null : s.selectedBubbleId,
        bubbleUndoStack: {
          ...s.bubbleUndoStack,
          [pageId]: [...pageUndo, existing],
        },
        bubbleRedoStack: {
          ...s.bubbleRedoStack,
          [pageId]: [],
        },
      }));

      await savePageBubbles(pageId, surviving);
      return manualCount;
    }

    // Chapter scope: only delete records with provenance === 'manual_selection' per page
    let totalCleared = 0;
    const nextBubblesByPage: Record<string, BubbleItem[]> = { ...state.bubblesByPage };
    const nextUndoStack: Record<string, BubbleItem[][]> = { ...state.bubbleUndoStack };
    const nextRedoStack: Record<string, BubbleItem[][]> = { ...state.bubbleRedoStack };
    let clearSelected = false;

    for (const pid of chapterPageIds) {
      const existing = nextBubblesByPage[pid] ?? (await getPageBubbles(pid));
      const manualCount = existing.filter((b) => b.provenance === 'manual_selection').length;
      if (manualCount === 0) continue;

      totalCleared += manualCount;
      const surviving = existing
        .filter((b) => b.provenance !== 'manual_selection')
        .map((b, idx) => ({ ...b, index: idx + 1 }));
      if (
        state.selectedBubbleId &&
        existing.some((b) => b.id === state.selectedBubbleId && b.provenance === 'manual_selection')
      ) {
        clearSelected = true;
      }

      nextUndoStack[pid] = [...(nextUndoStack[pid] || []).slice(-39), existing];
      nextRedoStack[pid] = [];
      nextBubblesByPage[pid] = surviving;
      await savePageBubbles(pid, surviving);
    }

    if (totalCleared > 0) {
      set((s) => ({
        bubblesByPage: nextBubblesByPage,
        bubbleUndoStack: nextUndoStack,
        bubbleRedoStack: nextRedoStack,
        selectedBubbleId: clearSelected ? null : s.selectedBubbleId,
      }));
    }

    return totalCleared;
  },

  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];

    let updatedPatch: Partial<BubbleItem> = { ...patch };

    // Mark as manually edited if source or translation text is modified
    if (patch.sourceText !== undefined || patch.translatedText !== undefined) {
      updatedPatch.isManuallyEdited = true;
      if (patch.sourceText !== undefined) {
        const targetItem = existing.find((b) => b.id === bubbleId);
        if (targetItem?.provenance === 'manual_selection' && patch.manualExtractionStatus === undefined) {
          updatedPatch.manualExtractionStatus = 'manual_text';
        }
      }
    }
    updatedPatch.updatedAt = Date.now();

    // Canonical typer prefix & shared color snapshot synchronization
    let pushTypeUndo = false;
    if (patch.type && patch.typerPrefix === undefined) {
      pushTypeUndo = true;
      if (patch.type === 'none') {
        updatedPatch.typerPrefix = '';
        updatedPatch.manualColorSnapshot = undefined;
      } else {
        const typerSettings = loadTyperSettings();
        const resolved = resolveCanonicalTyper(patch.type, typerSettings.typers);
        const visual = resolveTyperVisual(
          { type: resolved.id, typerPrefix: resolved.prefix },
          typerSettings.typers
        );
        updatedPatch.type = resolved.id;
        updatedPatch.typerPrefix = resolved.prefix;
        if (visual.isClassified) {
          updatedPatch.manualColorSnapshot = visual.color;
        }
      }
    }

    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const history = [...(b.translationHistory || [])];
      if (patch.translatedText !== undefined && patch.translatedText !== b.translatedText) {
        history.push({ timestamp: Date.now(), type: 'manual', text: patch.translatedText });
      }
      return { ...b, ...updatedPatch, translationHistory: history };
    });

    set((s) => {
      const pageUndo = (s.bubbleUndoStack[pageId] || []).slice(-39);
      return {
        bubblesByPage: {
          ...s.bubblesByPage,
          [pageId]: updated,
        },
        ...(pushTypeUndo
          ? {
              bubbleUndoStack: {
                ...s.bubbleUndoStack,
                [pageId]: [...pageUndo, existing],
              },
              bubbleRedoStack: {
                ...s.bubbleRedoStack,
                [pageId]: [],
              },
            }
          : {}),
      };
    });

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to update bubble in IDB', err)
    );
  },

  deleteBubble: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    if (!existing.some((b) => b.id === bubbleId)) return;

    const filtered = existing.filter((b) => b.id !== bubbleId);
    const reindexed = filtered.map((b, idx) => ({ ...b, index: idx + 1 }));
    const pageUndo = (state.bubbleUndoStack[pageId] || []).slice(-39);

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: reindexed,
      },
      selectedBubbleId: s.selectedBubbleId === bubbleId ? null : s.selectedBubbleId,
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, reindexed).catch((err) =>
      console.error('[WorkbenchStore] Failed to delete bubble in IDB', err)
    );
  },

  reorderBubbles: (pageId: string, startIndex: number, endIndex: number) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    if (
      startIndex < 0 ||
      startIndex >= existing.length ||
      endIndex < 0 ||
      endIndex >= existing.length ||
      startIndex === endIndex
    ) {
      return;
    }

    const items = [...existing];
    const [moved] = items.splice(startIndex, 1);
    items.splice(endIndex, 0, moved);

    const reindexed = items.map((b, idx) => ({ ...b, index: idx + 1 }));

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: reindexed,
      },
    }));

    savePageBubbles(pageId, reindexed).catch((err) =>
      console.error('[WorkbenchStore] Failed to reorder bubbles in IDB', err)
    );
  },

  splitBubble: (
    pageId: string,
    bubbleId: string,
    splitIndex: number,
    field: 'sourceText' | 'translatedText' = 'sourceText'
  ) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const targetIdx = existing.findIndex((b) => b.id === bubbleId);
    if (targetIdx === -1) return;

    const target = existing[targetIdx];
    const sharedRegionId = target.regionId || target.id;
    const now = Date.now();

    let updatedTarget: BubbleItem;
    let newBubble: BubbleItem;

    if (field === 'translatedText') {
      const fullTransText = target.translatedText || '';
      if (splitIndex <= 0 || splitIndex >= fullTransText.length) return;

      const textBefore = fullTransText.slice(0, splitIndex);
      const textAfter = fullTransText.slice(splitIndex);

      updatedTarget = {
        ...target,
        regionId: sharedRegionId,
        translatedText: textBefore,
        isManuallyEdited: true,
        updatedAt: now,
      };

      newBubble = {
        id: `bubble-${now}-${Math.random().toString(36).substring(2, 7)}`,
        pageId: target.pageId,
        chapterId: target.chapterId,
        index: target.index + 1,
        regionId: sharedRegionId,
        box_2d: [...target.box_2d],
        type: target.type,
        typerPrefix: target.typerPrefix,
        sourceLanguage: target.sourceLanguage,
        sourceText: '',
        originalSourceText: '',
        translatedText: textAfter,
        rawTranslatedText: textAfter,
        humanizedTranslatedText: textAfter,
        translationHistory: [],
        reviewFlags: [],
        confidence: target.confidence,
        isManuallyEdited: true,
        updatedAt: now,
      };
    } else {
      const fullSourceText = target.sourceText || '';
      if (splitIndex <= 0 || splitIndex >= fullSourceText.length) return;

      const textBefore = fullSourceText.slice(0, splitIndex);
      const textAfter = fullSourceText.slice(splitIndex);

      updatedTarget = {
        ...target,
        regionId: sharedRegionId,
        sourceText: textBefore,
        isManuallyEdited: true,
        updatedAt: now,
      };

      newBubble = {
        id: `bubble-${now}-${Math.random().toString(36).substring(2, 7)}`,
        pageId: target.pageId,
        chapterId: target.chapterId,
        index: target.index + 1,
        regionId: sharedRegionId,
        box_2d: [...target.box_2d],
        type: target.type,
        typerPrefix: target.typerPrefix,
        sourceLanguage: target.sourceLanguage,
        sourceText: textAfter,
        originalSourceText: textAfter,
        translatedText: '',
        rawTranslatedText: '',
        humanizedTranslatedText: '',
        translationHistory: [],
        reviewFlags: [],
        confidence: target.confidence,
        isManuallyEdited: true,
        updatedAt: now,
      };
    }

    const updatedList = [
      ...existing.slice(0, targetIdx),
      updatedTarget,
      newBubble,
      ...existing.slice(targetIdx + 1),
    ].map((b, idx) => ({ ...b, index: idx + 1 }));

    const pageUndo = state.bubbleUndoStack[pageId] || [];

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updatedList,
      },
      selectedBubbleId: newBubble.id,
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, updatedList).catch((err) =>
      console.error('[WorkbenchStore] Failed to save split bubble to IDB', err)
    );
  },

  transferText: (pageId, params) => {
    const {
      sourceBubbleId,
      sourceField,
      sourceStart,
      sourceEnd,
      destBubbleId,
      destField,
      dropPos,
      transferredText,
    } = params;
    if (!transferredText) return;

    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const sourceIdx = existing.findIndex((b) => b.id === sourceBubbleId);
    const destIdx = existing.findIndex((b) => b.id === destBubbleId);
    if (sourceIdx === -1 || destIdx === -1) return;

    const now = Date.now();
    const updatedList = [...existing];

    if (sourceBubbleId === destBubbleId && sourceField === destField) {
      const target = { ...existing[sourceIdx] };
      const currentVal = target[sourceField] || '';
      const before = currentVal.slice(0, sourceStart);
      const after = currentVal.slice(sourceEnd);
      const remaining = before + after;

      if (dropPos >= sourceStart && dropPos <= sourceEnd) {
        return;
      }
      let adjDropPos = dropPos;
      if (dropPos > sourceEnd) {
        adjDropPos = dropPos - (sourceEnd - sourceStart);
      }
      adjDropPos = Math.max(0, Math.min(remaining.length, adjDropPos));
      const finalVal = remaining.slice(0, adjDropPos) + transferredText + remaining.slice(adjDropPos);

      target[sourceField] = finalVal;
      target.isManuallyEdited = true;
      target.updatedAt = now;
      updatedList[sourceIdx] = target;
    } else {
      const source = { ...existing[sourceIdx] };
      const dest = { ...existing[destIdx] };

      const sourceVal = source[sourceField] || '';
      const sourceBefore = sourceVal.slice(0, sourceStart);
      const sourceAfter = sourceVal.slice(sourceEnd);
      source[sourceField] = sourceBefore + sourceAfter;
      source.isManuallyEdited = true;
      source.updatedAt = now;

      const destVal = dest[destField] || '';
      const safeDropPos = Math.max(0, Math.min(destVal.length, dropPos));
      dest[destField] = destVal.slice(0, safeDropPos) + transferredText + destVal.slice(safeDropPos);
      dest.isManuallyEdited = true;
      dest.updatedAt = now;

      updatedList[sourceIdx] = source;
      updatedList[destIdx] = dest;
    }

    const pageUndo = state.bubbleUndoStack[pageId] || [];
    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updatedList,
      },
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, existing],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [],
      },
    }));

    savePageBubbles(pageId, updatedList).catch((err) =>
      console.error('[WorkbenchStore] Failed to save transferred text to IDB', err)
    );
  },

  undoBubbleAction: (pageId: string) => {
    const state = get();
    const pageUndo = state.bubbleUndoStack[pageId] || [];
    if (pageUndo.length === 0) return;

    const previous = pageUndo[pageUndo.length - 1];
    const newUndo = pageUndo.slice(0, -1);
    const current = state.bubblesByPage[pageId] || [];
    const pageRedo = state.bubbleRedoStack[pageId] || [];

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: previous,
      },
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: newUndo,
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: [...pageRedo, current],
      },
    }));

    savePageBubbles(pageId, previous).catch((err) =>
      console.error('[WorkbenchStore] Failed to apply undo in IDB', err)
    );
  },

  redoBubbleAction: (pageId: string) => {
    const state = get();
    const pageRedo = state.bubbleRedoStack[pageId] || [];
    if (pageRedo.length === 0) return;

    const next = pageRedo[pageRedo.length - 1];
    const newRedo = pageRedo.slice(0, -1);
    const current = state.bubblesByPage[pageId] || [];
    const pageUndo = state.bubbleUndoStack[pageId] || [];

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: next,
      },
      bubbleUndoStack: {
        ...s.bubbleUndoStack,
        [pageId]: [...pageUndo, current],
      },
      bubbleRedoStack: {
        ...s.bubbleRedoStack,
        [pageId]: newRedo,
      },
    }));

    savePageBubbles(pageId, next).catch((err) =>
      console.error('[WorkbenchStore] Failed to apply redo in IDB', err)
    );
  },

  // Finding Lifecycle: Accept Flag with History Preservation
  acceptFlag: (pageId: string, bubbleId: string, flagId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const targetBubble = existing.find((b) => b.id === bubbleId);
    if (!targetBubble) return;

    const targetFlag = targetBubble.reviewFlags.find((f) => f.id === flagId);
    if (!targetFlag) return;

    // If remove_bubble, delete the bubble completely
    if (targetFlag.category === 'remove_bubble') {
      get().deleteBubble(pageId, bubbleId);
      return;
    }

    // Apply specific proposed fix
    let newTranslated = targetBubble.translatedText;
    let newType = targetBubble.type;
    let newPrefix = targetBubble.typerPrefix;

    if (targetFlag.suggestedTextAr) {
      newTranslated = targetFlag.suggestedTextAr;
    }
    if (targetFlag.suggestedType) {
      const typerSettings = loadTyperSettings();
      const resolved = resolveCanonicalTyper(targetFlag.suggestedType, typerSettings.typers);
      newType = resolved.id;
      newPrefix = resolved.prefix;
    }

    // Mark flag as accepted in history rather than destroying evidence
    const updatedFlags = targetBubble.reviewFlags.map((f) => {
      if (f.id !== flagId) return f;
      return {
        ...f,
        status: 'accepted' as const,
        resolvedAt: Date.now(),
        resolutionDetail: 'accepted_suggestion',
      };
    });

    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        translatedText: newTranslated,
        type: newType,
        typerPrefix: newPrefix,
        reviewFlags: updatedFlags.filter((f) => f.status === 'pending'), // Active feed shows pending flags
        isManuallyEdited: true,
        updatedAt: Date.now(),
      };
    });

    // Handle suggested reordering if specified
    if (
      typeof targetFlag.suggestedOrderIndex === 'number' &&
      targetFlag.suggestedOrderIndex > 0 &&
      targetFlag.suggestedOrderIndex <= updated.length &&
      targetFlag.suggestedOrderIndex !== targetBubble.index
    ) {
      const fromIdx = targetBubble.index - 1;
      const toIdx = targetFlag.suggestedOrderIndex - 1;
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
    }

    const reindexed = updated.map((b, idx) => ({ ...b, index: idx + 1 }));

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: reindexed,
      },
    }));

    savePageBubbles(pageId, reindexed).catch((err) =>
      console.error('[WorkbenchStore] Failed to save flag acceptance to IDB', err)
    );
    updateReviewFindingStatus(flagId, 'accepted', 'Accepted by user', 'user').catch(() => {});
  },

  // Finding Lifecycle: Dismiss Flag with History Preservation
  dismissFlag: (pageId: string, bubbleId: string, flagId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];

    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      // Mark as dismissed with timestamp
      const updatedFlags = b.reviewFlags.map((f) => {
        if (f.id !== flagId) return f;
        return {
          ...f,
          status: 'dismissed' as const,
          resolvedAt: Date.now(),
          resolutionDetail: 'dismissed_by_user',
        };
      });

      return {
        ...b,
        reviewFlags: updatedFlags.filter((f) => f.status === 'pending'),
        updatedAt: Date.now(),
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to save flag dismissal to IDB', err)
    );
    updateReviewFindingStatus(flagId, 'rejected', 'Dismissed by user', 'user').catch(() => {});
  },

  revertSourceText: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return { ...b, sourceText: b.originalSourceText, updatedAt: Date.now() };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to revert source text in IDB', err)
    );
  },

  revertTranslatedText: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const now = Date.now();
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const history = [...(b.translationHistory || [])];

      // Revert hierarchy:
      // If user has edited manual text and humanized version exists, revert to humanized first.
      // If already equal to humanized, revert to raw model output.
      let targetText = b.rawTranslatedText || b.translatedText;
      let targetType: 'humanized' | 'raw' = 'raw';

      if (b.humanizedTranslatedText && b.translatedText !== b.humanizedTranslatedText) {
        targetText = b.humanizedTranslatedText;
        targetType = 'humanized';
      } else if (b.rawTranslatedText && b.translatedText !== b.rawTranslatedText) {
        targetText = b.rawTranslatedText;
        targetType = 'raw';
      }

      history.push({ timestamp: now, type: targetType, text: targetText });

      return {
        ...b,
        translatedText: targetText,
        isManuallyEdited: false,
        translationHistory: history,
        updatedAt: now,
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to revert translation in IDB', err)
    );
  },

  revertToRawTranslation: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const now = Date.now();
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const targetText = b.rawTranslatedText || b.translatedText;
      const history = [...(b.translationHistory || []), { timestamp: now, type: 'raw' as const, text: targetText }];
      return {
        ...b,
        translatedText: targetText,
        isManuallyEdited: false,
        translationHistory: history,
        updatedAt: now,
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to revert to raw translation in IDB', err)
    );
  },

  revertToHumanizedTranslation: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const now = Date.now();
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const targetText = b.humanizedTranslatedText || b.rawTranslatedText || b.translatedText;
      const history = [...(b.translationHistory || []), { timestamp: now, type: 'humanized' as const, text: targetText }];
      return {
        ...b,
        translatedText: targetText,
        isManuallyEdited: false,
        translationHistory: history,
        updatedAt: now,
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to revert to humanized translation in IDB', err)
    );
  },

  reconcileActiveSFXState: async (_includeSFX: boolean) => {
    // Phase 1.3: Non-destructive SFX handling.
    // SFX records and OCR data remain safely stored in memory and IndexedDB.
    // SFX visibility on the canvas is governed dynamically by scanning.include_sfx settings in CanvasPane.
  },

  // 1. Scan All (Batch Chapter Scan)
  startBatchScan: (pages, projectId = null, isDraft = false) => {
    const chapterId = get().activeChapterId || undefined;
    const snapshot = settingsService.createOperationSnapshot({ projectId, chapterId });
    const apiKey = snapshot.values['general.gemini_api_key'] || '';
    const rawModel = String(snapshot.values['translation.model'] || 'gemini-3.8-flash');
    const customModel = String(snapshot.values['translation.custom_model'] || '').trim();
    const selectedModel = (rawModel === 'custom' && customModel
      ? customModel
      : rawModel === 'custom'
      ? 'gemini-3.8-flash'
      : rawModel) as GeminiModelKey;
    const eloquenceLevel = (snapshot.values['translation.eloquence'] as EloquenceLevel) || 2;
    const includeSFX = Boolean(snapshot.values['scanning.include_sfx']);
    const translationFidelity = (snapshot.values['translation.fidelity'] as TranslationFidelity) || 'localized';
    const isHumanizerEnabled = Boolean(snapshot.values['translation.humanizer_enabled']);
    const humanizerIntensity = (snapshot.values['translation.humanizer_intensity'] as HumanizerIntensity) || 'balanced';
    const orthographyMode = (snapshot.values['translation.orthography_mode'] as OrthographyMode) || 'correct_spelling';
    const masterPromptOverride = snapshot.values['translation.master_prompt_override'] || '';
    const isMasterPromptActive = Boolean(snapshot.values['translation.master_prompt_active']);
    const readingConvention = (snapshot.values['scanning.reading_convention'] as any) || 'auto';
    const sourceLanguageHint = String(snapshot.values['scanning.source_language'] || 'auto');
    const scanProfile = String(snapshot.values['scanning.profile'] || 'balanced');
    const ocrConfidenceThreshold = Number(snapshot.values['scanning.ocr_confidence_threshold'] ?? 0.65);
    const enableCropRetries =
      scanProfile === 'fast'
        ? false
        : Boolean(snapshot.values['scanning.enable_crop_retries'] ?? true);
    const cropRetryLimit = enableCropRetries
      ? Number(snapshot.values['scanning.max_crop_retries'] ?? 3)
      : 0;

    const sortedPages = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
    const queueItems = sortedPages.map((p, idx) => ({
      pageId: p.pageId,
      chapterId,
      pageIndex: p.pageIndex,
      previousPageId: idx > 0 ? sortedPages[idx - 1].pageId : undefined,
      options: {
        projectId,
        isDraft,
        apiKey,
        selectedModel,
        eloquenceLevel,
        includeSFX,
        sourceLanguageHint,
        readingConvention,
        translationFidelity,
        isHumanizerEnabled,
        humanizerIntensity,
        orthographyMode,
        masterPromptOverride,
        isMasterPromptActive,
        enableCropRetries,
        cropRetryLimit,
        ocrConfidenceThreshold,
      },
    }));

    if (unsubscribeBatchScanQueue) {
      unsubscribeBatchScanQueue();
      unsubscribeBatchScanQueue = null;
    }

    unsubscribeBatchScanQueue = scanQueue.subscribe((progress) => {
      const isBatch = progress.totalCount > 1;
      const activeStep = Math.min(progress.completedCount + 1, Math.max(1, progress.totalCount));
      set({
        isScanningActive: isBatch && progress.isScanning,
        isScanningSinglePage: !isBatch && progress.isScanning,
        pageStatuses: progress.pageStatuses,
        detailedPageStatuses: progress.detailedPageStatuses || {},
        scanProgressText: isBatch && progress.isScanning
          ? `${activeStep}/${progress.totalCount} - CANCEL`
          : null,
      });
    });

    scanQueue.enqueue(queueItems, (pageId, newBubbles) => {
      set((s) => ({
        bubblesByPage: {
          ...s.bubblesByPage,
          [pageId]: newBubbles,
        },
      }));
    });
  },

  cancelBatchScan: () => {
    scanQueue.cancel();
    set({
      isScanningActive: false,
      isScanningSinglePage: false,
      scanProgressText: null,
    });
  },

  // 2. Scan Page (Single Page Scan)
  scanSinglePage: (pageId, pageIndex, projectId = null, isDraft = false) => {
    get().startBatchScan([{ pageId, pageIndex }], projectId, isDraft);
  },

  // 2b. Visual Interpretation (Re-interprets existing local OCR extraction without re-running OCR)
  interpretSinglePage: async (pageId: string, projectId: string | null = null) => {
    const state = get();
    const chapterId = state.activeChapterId || undefined;
    const snapshot = settingsService.createOperationSnapshot({ projectId, chapterId });
    const apiKey = snapshot.values['general.gemini_api_key'] || '';
    const selectedModel = snapshot.values['scanning.model'] || 'gemini-3.8-flash';
    const includeSFX = Boolean(snapshot.values['scanning.include_sfx']);
    const readingConvention = (snapshot.values['scanning.reading_convention'] as any) || 'auto';
    const sourceLanguageHint = (snapshot.values['ocr.source_language'] as string) || 'auto';
    const typerSettings = loadTyperSettings();

    set((s) => ({
      detailedPageStatuses: {
        ...s.detailedPageStatuses,
        [pageId]: 'scanning',
      },
    }));

    try {
      const outcome = await interpretPageVisualContext({
        pageId,
        chapterId,
        projectId,
        apiKey,
        selectedModel: String(selectedModel),
        includeSFX,
        readingConvention,
        sourceLanguageHint,
        configuredTypers: typerSettings.typers,
      });

      if (outcome.success) {
        set((s) => ({
          bubblesByPage: {
            ...s.bubblesByPage,
            [pageId]: outcome.bubbles,
          },
          detailedPageStatuses: {
            ...s.detailedPageStatuses,
            [pageId]: 'ocr_complete_interpretation_complete',
          },
        }));
      } else {
        set((s) => ({
          detailedPageStatuses: {
            ...s.detailedPageStatuses,
            [pageId]: 'ocr_complete_interpretation_failed',
          },
        }));
      }
      return outcome;
    } catch (err: any) {
      set((s) => ({
        detailedPageStatuses: {
          ...s.detailedPageStatuses,
          [pageId]: 'ocr_complete_interpretation_failed',
        },
      }));
      throw err;
    }
  },

  // 3. Single Bubble Translation
  translateSingleBubble: async (pageId, bubbleId, projectId = null, isDraft = false) => {
    const state = get();
    const pageBubbles = state.bubblesByPage[pageId] || [];
    const targetBubble = pageBubbles.find((b) => b.id === bubbleId);
    if (!targetBubble) {
      throw new Error('Target bubble not found.');
    }

    const chapterId = state.activeChapterId || undefined;
    const snapshot = settingsService.createOperationSnapshot({ projectId, chapterId });
    const apiKey = snapshot.values['general.gemini_api_key'] || '';
    const selectedModel = (snapshot.values['translation.model'] as GeminiModelKey) || 'gemini-3.8-flash';
    const eloquenceLevel = (snapshot.values['translation.eloquence'] as EloquenceLevel) || 2;
    const translationFidelity = (snapshot.values['translation.fidelity'] as TranslationFidelity) || 'localized';
    const isHumanizerEnabled = Boolean(snapshot.values['translation.humanizer_enabled']);
    const humanizerIntensity = (snapshot.values['translation.humanizer_intensity'] as HumanizerIntensity) || 'balanced';
    const orthographyMode = (snapshot.values['translation.orthography_mode'] as OrthographyMode) || 'correct_spelling';
    const masterPromptOverride = snapshot.values['translation.master_prompt_override'] || '';
    const isMasterPromptActive = Boolean(snapshot.values['translation.master_prompt_active']);

    const result = await translateSingleBubbleWithGemini({
      pageId,
      chapterId,
      bubble: targetBubble,
      surroundingBubbles: pageBubbles,
      projectId,
      isDraft,
      apiKey,
      selectedModel,
      eloquenceLevel,
      translationFidelity,
      isHumanizerEnabled,
      humanizerIntensity,
      orthographyMode,
      masterPromptOverride,
      isMasterPromptActive,
    });

    const now = Date.now();
    const history = [...(targetBubble.translationHistory || [])];
    history.push({ timestamp: now, type: 'raw', text: result.rawTranslatedText });
    if (result.humanizedTranslatedText !== result.rawTranslatedText) {
      history.push({ timestamp: now, type: 'humanized', text: result.humanizedTranslatedText });
    }

    const patch: Partial<BubbleItem> = {
      translatedText: result.translatedText,
      rawTranslatedText: result.rawTranslatedText,
      humanizedTranslatedText: result.humanizedTranslatedText,
      translationHistory: history,
      isManuallyEdited: false,
      updatedAt: now,
    };
    if (result.sourceText && !targetBubble.sourceText) {
      patch.sourceText = result.sourceText;
      patch.originalSourceText = result.sourceText;
    }

    get().updateBubble(pageId, bubbleId, patch);
  },

  // 4. Review Page / Review All (Multimodal Visual Review & Global Chapter QC)
  runChapterReview: async (chapterId, pages, projectId = null, isDraft = false) => {
    const snapshot = settingsService.createOperationSnapshot({ projectId, chapterId });
    const apiKey = snapshot.values['general.gemini_api_key'] || '';
    const selectedModel = (snapshot.values['translation.model'] as GeminiModelKey) || 'gemini-3.8-flash';
    const eloquenceLevel = (snapshot.values['translation.eloquence'] as EloquenceLevel) || 2;
    const masterPromptOverride = snapshot.values['translation.master_prompt_override'] || '';
    const isMasterPromptActive = Boolean(snapshot.values['translation.master_prompt_active']);

    const isSinglePage = pages.length === 1;
    if (isSinglePage) {
      set({ isReviewingSinglePage: true });
    } else {
      set({ isReviewingChapter: true });
    }

    try {
      const auditResult = await auditChapterWithGemini({
        chapterId,
        projectId,
        isDraft,
        pages: pages.map((p) => ({ pageId: p.pageId, pageIndex: p.pageIndex })),
        apiKey,
        selectedModel,
        eloquenceLevel,
        masterPromptOverride,
        isMasterPromptActive,
      });

      // Synchronize updated bubbles across all audited pages
      set((s) => ({
        bubblesByPage: {
          ...s.bubblesByPage,
          ...auditResult.updatedBubblesByPage,
        },
        isReviewingChapter: false,
        isReviewingSinglePage: false,
      }));
    } catch (err) {
      console.error('[WorkbenchStore] Chapter review error:', err);
      set({ isReviewingChapter: false, isReviewingSinglePage: false });
      throw err;
    }
  },

  loadMemoryCandidates: async (projectId: string) => {
    try {
      const driver = projectMemory.getDriver();
      const candidates = await driver.getCandidatesByProject(projectId);
      const conflicts = await driver.getConflictsByProject(projectId);
      set({
        memoryCandidates: candidates.filter((c) => c.review_state === 'ready_for_approval'),
        memoryConflicts: conflicts.filter((c) => c.status === 'unresolved'),
      });
    } catch (err) {
      console.warn('[WorkbenchStore] Failed to load memory candidates:', err);
    }
  },

  approveMemoryCandidate: async (candidateId: string) => {
    try {
      const res = await projectMemory.approveKnowledgeCandidate(candidateId);
      if (res.status === 'success' && res.data) {
        const folderId = get().activeFolderId;
        if (folderId) {
          await get().loadMemoryCandidates(folderId);
          const lore = await getProjectLore(folderId);
          set({ projectLore: lore });
        }
      }
    } catch (err) {
      console.error('[WorkbenchStore] Failed to approve memory candidate:', err);
    }
  },

  rejectMemoryCandidate: async (candidateId: string, reason: string = 'Dismissed by user') => {
    try {
      await projectMemory.rejectKnowledgeCandidate(candidateId, reason);
      const folderId = get().activeFolderId;
      if (folderId) {
        await get().loadMemoryCandidates(folderId);
      }
    } catch (err) {
      console.error('[WorkbenchStore] Failed to reject memory candidate:', err);
    }
  },

  resolveMemoryConflict: async (conflictId: string, decision: string, value: any) => {
    try {
      await projectMemory.resolveKnowledgeConflict(conflictId, decision, value);
      const folderId = get().activeFolderId;
      if (folderId) {
        await get().loadMemoryCandidates(folderId);
        const lore = await getProjectLore(folderId);
        set({ projectLore: lore });
      }
    } catch (err) {
      console.error('[WorkbenchStore] Failed to resolve memory conflict:', err);
    }
  },
}));
