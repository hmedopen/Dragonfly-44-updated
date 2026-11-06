import { create } from 'zustand';
import type { 
  BubbleItem, 
  BubbleType, 
  PageScanStatus, 
  ProjectLoreLedger, 
  EloquenceLevel, 
  GeminiModelKey 
} from '../types/workbench';
import { BUBBLE_TYPE_CONFIG } from '../types/workbench';
import { loadTyperSettings } from '../types/typers';
import { getPageBubbles, savePageBubbles, getProjectLore } from '../services/db';
import { scanQueue } from '../lib/scanQueue';
import { auditChapterWithGemini } from '../lib/reviewEngine';
import { translateSingleBubbleWithGemini } from '../lib/geminiScan';

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

  // Tool & Drawer toggles
  isSettingsOpen: boolean;
  isKeyboardOpen: boolean;
  isTypeRModalOpen: boolean;
  isDrawBoxActive: boolean;
  zoomLevel: number;
  feedFilter: FeedFilterMode;

  // Scan Queue & Realtime Page Status
  isScanningActive: boolean;
  scanProgressText: string | null;
  pageStatuses: Record<string, PageScanStatus>;
  isReviewingChapter: boolean;
  isScanningSinglePage: boolean;
  isReviewingSinglePage: boolean;

  // Actions
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
  setIsTypeRModalOpen: (open: boolean) => void;
  toggleTypeRModal: () => void;
  setIsDrawBoxActive: (active: boolean) => void;
  toggleDrawBox: () => void;
  setZoomLevel: (zoom: number) => void;
  resetZoom: () => void;
  setFeedFilter: (filter: FeedFilterMode) => void;

  // Bubble actions
  loadPageBubbles: (pageId: string) => Promise<void>;
  addManualBubble: (pageId: string, initialBox?: [number, number, number, number]) => void;
  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => void;
  deleteBubble: (pageId: string, bubbleId: string) => void;
  reorderBubbles: (pageId: string, startIndex: number, endIndex: number) => void;
  acceptFlag: (pageId: string, bubbleId: string, flagId: string) => void;
  dismissFlag: (pageId: string, bubbleId: string, flagId: string) => void;
  revertSourceText: (pageId: string, bubbleId: string) => void;
  revertTranslatedText: (pageId: string, bubbleId: string) => void;

  // Queue & QC Review Actions
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
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  currentView: 'hub',
  activeFolderId: null,
  activeChapterId: null,
  activePageId: null,
  viewportMode: 'manga-flip',
  selectedBubbleId: null,
  bubblesByPage: {},
  projectLore: null,

  // Modals & Panels
  isSettingsOpen: false,
  isKeyboardOpen: false,
  isTypeRModalOpen: false,
  isDrawBoxActive: false,
  zoomLevel: 100,
  feedFilter: 'all',

  // Real-time Queue & Audit State
  isScanningActive: false,
  scanProgressText: null,
  pageStatuses: {},
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

    // If folderId is a project folder, hydrate project lore
    if (folderId && folderId !== 'folder-drafts') {
      getProjectLore(folderId).then((lore) => {
        set({ projectLore: lore });
      });
    } else {
      set({ projectLore: null });
    }
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
      isTypeRModalOpen: false,
    }),

  setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setIsKeyboardOpen: (open) => set({ isKeyboardOpen: open }),
  toggleKeyboard: () => set((s) => ({ isKeyboardOpen: !s.isKeyboardOpen })),
  setIsTypeRModalOpen: (open) => set({ isTypeRModalOpen: open }),
  toggleTypeRModal: () => set((s) => ({ isTypeRModalOpen: !s.isTypeRModalOpen })),
  setIsDrawBoxActive: (active) => set({ isDrawBoxActive: active }),
  toggleDrawBox: () => set((s) => ({ isDrawBoxActive: !s.isDrawBoxActive })),
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
      console.error('Failed to load page bubbles from IndexedDB', err);
      set((state) => ({
        bubblesByPage: {
          ...state.bubblesByPage,
          [pageId]: [],
        },
      }));
    }
  },

  addManualBubble: (pageId: string, initialBox?: [number, number, number, number]) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const nextIndex = existing.length + 1;

    const typerSettings = loadTyperSettings();
    const defaultSpeechTyper = typerSettings.typers.find(
      (t) => t.id === 'speech_bubbles' || t.name.toLowerCase() === 'speech bubbles'
    );
    const initialType = defaultSpeechTyper ? defaultSpeechTyper.id : (typerSettings.typers[0]?.id || 'none');
    const initialPrefix = defaultSpeechTyper ? defaultSpeechTyper.prefix : (typerSettings.typers[0]?.prefix || '');

    const newBubble: BubbleItem = {
      id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pageId,
      index: nextIndex,
      box_2d: initialBox || [350, 250, 550, 650],
      type: initialType,
      typerPrefix: initialPrefix,
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
    };

    const updated = [...existing, newBubble];

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
      selectedBubbleId: newBubble.id,
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('Failed to save new bubble to IndexedDB', err)
    );
  },

  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];

    let updatedPatch = { ...patch };
    if (patch.type && patch.typerPrefix === undefined) {
      if (patch.type === 'none') {
        updatedPatch.typerPrefix = '';
      } else {
        const typerSettings = loadTyperSettings();
        const matched = typerSettings.typers.find((t) => t.id === patch.type);
        if (matched) {
          updatedPatch.typerPrefix = matched.prefix;
        } else {
          const typeConfig = BUBBLE_TYPE_CONFIG[patch.type as BubbleType];
          if (typeConfig) {
            updatedPatch.typerPrefix = typeConfig.prefix;
          }
        }
      }
    }

    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return { ...b, ...updatedPatch };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('Failed to update bubble in IndexedDB', err)
    );
  },

  deleteBubble: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const filtered = existing.filter((b) => b.id !== bubbleId);
    const reindexed = filtered.map((b, idx) => ({ ...b, index: idx + 1 }));

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: reindexed,
      },
      selectedBubbleId: s.selectedBubbleId === bubbleId ? null : s.selectedBubbleId,
    }));

    savePageBubbles(pageId, reindexed).catch((err) =>
      console.error('Failed to delete bubble in IndexedDB', err)
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
      console.error('Failed to save reordered bubbles to IndexedDB', err)
    );
  },

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
      newType = targetFlag.suggestedType;
      const typerSettings = loadTyperSettings();
      const matched = typerSettings.typers.find((t) => t.id === newType);
      if (matched) {
        newPrefix = matched.prefix;
      } else {
        const cfg = BUBBLE_TYPE_CONFIG[newType];
        if (cfg) newPrefix = cfg.prefix;
      }
    }

    // Remove ONLY this flag from reviewFlags
    const remainingFlags = targetBubble.reviewFlags.filter((f) => f.id !== flagId);

    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return {
        ...b,
        translatedText: newTranslated,
        type: newType,
        typerPrefix: newPrefix,
        reviewFlags: remainingFlags,
      };
    });

    // If suggestedOrderIndex exists and differs, handle reorder
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
      console.error('Failed to save flag acceptance to DB', err)
    );
  },

  dismissFlag: (pageId: string, bubbleId: string, flagId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];

    // Remove ONLY this flag without modifying text, tag, or order
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      const remainingFlags = b.reviewFlags.filter((f) => f.id !== flagId);
      return {
        ...b,
        reviewFlags: remainingFlags,
      };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('Failed to save flag dismissal to DB', err)
    );
  },

  revertSourceText: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return { ...b, sourceText: b.originalSourceText };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('Failed to revert source text in DB', err)
    );
  },

  revertTranslatedText: (pageId: string, bubbleId: string) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const updated = existing.map((b) => {
      if (b.id !== bubbleId) return b;
      return { ...b, translatedText: b.rawTranslatedText };
    });

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('Failed to revert translated text in DB', err)
    );
  },

  // FIFO Queue & Realtime Scan Engine
  startBatchScan: (pages, projectId = null, isDraft = false) => {
    const apiKey = localStorage.getItem('dragonfly44_gemini_api_key') || '';
    const selectedModel = (localStorage.getItem('dragonfly44_selected_model') as GeminiModelKey) || 'gemini-3.1-flash-lite';
    const eloquenceLevel = Number(localStorage.getItem('dragonfly44_eloquence_level') || '2') as EloquenceLevel;
    const includeSFX = localStorage.getItem('dragonfly44_include_sfx') === 'true';
    const masterPromptOverride = localStorage.getItem('dragonfly44_master_prompt_override') || '';
    const isMasterPromptActive = localStorage.getItem('dragonfly44_master_prompt_active') !== 'false';

    const queueItems = pages.map((p) => ({
      pageId: p.pageId,
      pageIndex: p.pageIndex,
      options: {
        projectId,
        isDraft,
        apiKey,
        selectedModel,
        eloquenceLevel,
        includeSFX,
        masterPromptOverride,
        isMasterPromptActive,
      },
    }));

    // Subscribe to scanQueue progress
    scanQueue.subscribe((progress) => {
      const isBatch = progress.totalCount > 1;
      set({
        isScanningActive: isBatch && progress.isScanning,
        isScanningSinglePage: !isBatch && progress.isScanning,
        pageStatuses: progress.pageStatuses,
        scanProgressText: isBatch && progress.isScanning
          ? `${progress.completedCount + 1}/${progress.totalCount} - CANCEL`
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

  scanSinglePage: (pageId, pageIndex, projectId = null, isDraft = false) => {
    get().startBatchScan([{ pageId, pageIndex }], projectId, isDraft);
  },

  translateSingleBubble: async (pageId, bubbleId, projectId = null, isDraft = false) => {
    const state = get();
    const pageBubbles = state.bubblesByPage[pageId] || [];
    const targetBubble = pageBubbles.find((b) => b.id === bubbleId);
    if (!targetBubble) {
      throw new Error('Target bubble not found.');
    }

    const apiKey = localStorage.getItem('dragonfly44_gemini_api_key') || '';
    const selectedModel = (localStorage.getItem('dragonfly44_selected_model') as GeminiModelKey) || 'gemini-3.1-flash-lite';
    const eloquenceLevel = (Number(localStorage.getItem('dragonfly44_eloquence_level') || '2') as EloquenceLevel) || 2;
    const masterPromptOverride = localStorage.getItem('dragonfly44_master_prompt_override') || '';
    const isMasterPromptActive = localStorage.getItem('dragonfly44_master_prompt_active') !== 'false';

    const result = await translateSingleBubbleWithGemini({
      pageId,
      bubble: targetBubble,
      surroundingBubbles: pageBubbles,
      projectId,
      isDraft,
      apiKey,
      selectedModel,
      eloquenceLevel,
      masterPromptOverride,
      isMasterPromptActive,
    });

    const patch: Partial<BubbleItem> = {
      translatedText: result.translatedText,
      rawTranslatedText: result.translatedText,
    };
    if (result.sourceText && !targetBubble.sourceText) {
      patch.sourceText = result.sourceText;
      patch.originalSourceText = result.sourceText;
    }

    get().updateBubble(pageId, bubbleId, patch);
  },

  // QC Audit Review Engine
  runChapterReview: async (chapterId, pages, projectId = null, isDraft = false) => {
    const apiKey = localStorage.getItem('dragonfly44_gemini_api_key') || '';
    const selectedModel = (localStorage.getItem('dragonfly44_selected_model') as GeminiModelKey) || 'gemini-3.8-flash';
    const eloquenceLevel = Number(localStorage.getItem('dragonfly44_eloquence_level') || '2') as EloquenceLevel;
    const masterPromptOverride = localStorage.getItem('dragonfly44_master_prompt_override') || '';
    const isMasterPromptActive = localStorage.getItem('dragonfly44_master_prompt_active') !== 'false';

    const isSinglePage = pages.length === 1;
    if (isSinglePage) {
      set({ isReviewingSinglePage: true });
    } else {
      set({ isReviewingChapter: true });
    }

    try {
      const state = get();
      const payloadPages = pages.map((p) => ({
        pageId: p.pageId,
        pageIndex: p.pageIndex,
        bubbles: state.bubblesByPage[p.pageId] || [],
      }));

      const auditResult = await auditChapterWithGemini({
        chapterId,
        projectId,
        isDraft,
        pages: payloadPages,
        apiKey,
        selectedModel,
        eloquenceLevel,
        masterPromptOverride,
        isMasterPromptActive,
      });

      // Update bubbles across pages
      set((s) => ({
        bubblesByPage: {
          ...s.bubblesByPage,
          ...auditResult.updatedBubblesByPage,
        },
        isReviewingChapter: false,
        isReviewingSinglePage: false,
      }));
    } catch (err) {
      console.error('Failed to run chapter review:', err);
      set({ isReviewingChapter: false, isReviewingSinglePage: false });
      throw err;
    }
  },
}));
