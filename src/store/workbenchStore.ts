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
import { loadTyperSettings, resolveCanonicalTyper } from '../types/typers';
import { getPageBubbles, savePageBubbles, getProjectLore, updateReviewFindingStatus } from '../services/db';
import { getChapterIntelligence } from '../services/intelligence';
import { projectMemory } from '../services/projectMemory';
import type { KnowledgeCandidate, KnowledgeConflictSet } from '../types/memory';
import { scanQueue } from '../lib/scanQueue';
import { auditChapterWithGemini } from '../lib/reviewEngine';
import { translateSingleBubbleWithGemini } from '../lib/geminiScan';
import { settingsService } from '../services/settings/settingsService';

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
  setIsTypeRModalOpen: (open: boolean) => void;
  toggleTypeRModal: () => void;
  setIsDrawBoxActive: (active: boolean) => void;
  toggleDrawBox: () => void;
  setZoomLevel: (zoom: number) => void;
  resetZoom: () => void;
  setFeedFilter: (filter: FeedFilterMode) => void;

  // Bubble manipulation actions (with edit protection & flag lifecycle)
  loadPageBubbles: (pageId: string) => Promise<void>;
  addManualBubble: (pageId: string, initialBox?: [number, number, number, number]) => void;
  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => void;
  deleteBubble: (pageId: string, bubbleId: string) => void;
  reorderBubbles: (pageId: string, startIndex: number, endIndex: number) => void;
  splitBubble: (pageId: string, bubbleId: string, splitIndex: number) => void;
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

    // Hydrate Project Lore and Chapter Intelligence
    if (folderId && folderId !== 'folder-drafts') {
      getProjectLore(folderId).then((lore) => {
        set({ projectLore: lore });
      });
      get().loadMemoryCandidates(folderId);
    } else {
      set({ projectLore: null, memoryCandidates: [], memoryConflicts: [] });
    }

    getChapterIntelligence(chapterId).then((intel: ChapterIntelligence | null) => {
      set({ chapterIntelligence: intel });
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
      console.error('[WorkbenchStore] Failed to load bubbles from IndexedDB', err);
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
      chapterId: state.activeChapterId || undefined,
      index: nextIndex,
      box_2d: initialBox || [350, 250, 550, 650],
      type: initialType,
      typerPrefix: initialPrefix,
      sourceText: '',
      originalSourceText: '',
      translatedText: '',
      rawTranslatedText: '',
      reviewFlags: [],
      isManuallyEdited: true,
      updatedAt: Date.now(),
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
      console.error('[WorkbenchStore] Failed to save manual bubble to IDB', err)
    );
  },

  updateBubble: (pageId: string, bubbleId: string, patch: Partial<BubbleItem>) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];

    let updatedPatch = { ...patch };

    // Mark as manually edited if source or translation text is modified
    if (patch.sourceText !== undefined || patch.translatedText !== undefined) {
      updatedPatch.isManuallyEdited = true;
    }
    updatedPatch.updatedAt = Date.now();

    // Canonical typer prefix synchronization
    if (patch.type && patch.typerPrefix === undefined) {
      if (patch.type === 'none') {
        updatedPatch.typerPrefix = '';
      } else {
        const typerSettings = loadTyperSettings();
        const resolved = resolveCanonicalTyper(patch.type, typerSettings.typers);
        updatedPatch.type = resolved.id;
        updatedPatch.typerPrefix = resolved.prefix;
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

    set((s) => ({
      bubblesByPage: {
        ...s.bubblesByPage,
        [pageId]: updated,
      },
    }));

    savePageBubbles(pageId, updated).catch((err) =>
      console.error('[WorkbenchStore] Failed to update bubble in IDB', err)
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

  splitBubble: (pageId: string, bubbleId: string, splitIndex: number) => {
    const state = get();
    const existing = state.bubblesByPage[pageId] || [];
    const targetIdx = existing.findIndex((b) => b.id === bubbleId);
    if (targetIdx === -1) return;

    const target = existing[targetIdx];
    const fullSourceText = target.sourceText || '';
    if (splitIndex <= 0 || splitIndex >= fullSourceText.length) return;

    const textBefore = fullSourceText.slice(0, splitIndex);
    const textAfter = fullSourceText.slice(splitIndex);
    const sharedRegionId = target.regionId || target.id;
    const now = Date.now();

    const updatedTarget: BubbleItem = {
      ...target,
      regionId: sharedRegionId,
      sourceText: textBefore,
      isManuallyEdited: true,
      updatedAt: now,
    };

    const newBubble: BubbleItem = {
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
    const selectedModel = (snapshot.values['translation.model'] as GeminiModelKey) || 'gemini-3.8-flash';
    const eloquenceLevel = (snapshot.values['translation.eloquence'] as EloquenceLevel) || 2;
    const includeSFX = Boolean(snapshot.values['scanning.include_sfx']);
    const translationFidelity = (snapshot.values['translation.fidelity'] as TranslationFidelity) || 'localized';
    const isHumanizerEnabled = Boolean(snapshot.values['translation.humanizer_enabled']);
    const humanizerIntensity = (snapshot.values['translation.humanizer_intensity'] as HumanizerIntensity) || 'balanced';
    const orthographyMode = (snapshot.values['translation.orthography_mode'] as OrthographyMode) || 'correct_spelling';
    const masterPromptOverride = snapshot.values['translation.master_prompt_override'] || '';
    const isMasterPromptActive = Boolean(snapshot.values['translation.master_prompt_active']);
    const readingConvention = (snapshot.values['scanning.reading_convention'] as any) || 'auto';

    const queueItems = pages.map((p) => ({
      pageId: p.pageId,
      chapterId,
      pageIndex: p.pageIndex,
      options: {
        projectId,
        isDraft,
        apiKey,
        selectedModel,
        eloquenceLevel,
        includeSFX,
        readingConvention,
        translationFidelity,
        isHumanizerEnabled,
        humanizerIntensity,
        orthographyMode,
        masterPromptOverride,
        isMasterPromptActive,
      },
    }));

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

  // 2. Scan Page (Single Page Scan)
  scanSinglePage: (pageId, pageIndex, projectId = null, isDraft = false) => {
    get().startBatchScan([{ pageId, pageIndex }], projectId, isDraft);
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
