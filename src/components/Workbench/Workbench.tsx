import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Folder, Chapter } from '../../types';
import type { BubbleItem } from '../../types/workbench';
import { useWorkbenchStore } from '../../store/workbenchStore';
import { getPageBlob, getPageBubbles } from '../../services/db';
import { CanvasPane } from './CanvasPane';
import { FeedPane } from './FeedPane';
import { SettingsModal } from '../Settings/SettingsModal';
import { BenchmarkScreen } from '../Benchmark/BenchmarkScreen';
import { VirtualKeyboard } from '../Tools/VirtualKeyboard';
import { TypeRModal } from '../Export/TypeRModal';
import { ingestImageFiles, pickImageFiles } from '../../services/fileIngestion';
import { compileRawTextExtract } from '../../lib/compileTypeR';
import { loadTyperSettings } from '../../types/typers';
import { 
  ArrowLeft, 
  Menu, 
  FileText, 
  Keyboard,
  RotateCcw,
  ChevronDown,
  Plus,
  Sparkles,
  Search,
  MessageSquarePlus,
  BoxSelect,
  SquareDashed,
  BookOpen,
  X,
  Activity
} from 'lucide-react';
import { ToolbarTooltip } from './ToolbarTooltip';
import { isTrainingStudioEnabled } from '../../lib/training/env';
import { useConfirmationSetting } from '../../lib/confirmation';
import type { PageMetadata } from '../../types';

interface WorkbenchProps {
  folder: Folder | null;
  chapter: Chapter | null;
  onBack: () => void;
  onAddManualBubble?: () => void;
  onAppendPages?: (newPages: any[]) => void;
  onDeletePage?: (pageId: string) => void;
  onReorderPages?: (updatedPages: PageMetadata[]) => void;
  onOpenTrainingStudio?: () => void;
}

export const Workbench: React.FC<WorkbenchProps> = ({
  folder,
  chapter,
  onBack,
  onAddManualBubble,
  onAppendPages,
  onDeletePage,
  onReorderPages,
  onOpenTrainingStudio,
}) => {
  const {
    activePageId,
    setActivePageId,
    selectedBubbleId,
    setSelectedBubbleId,
    bubblesByPage,
    loadPageBubbles,
    addManualBubble,
    updateBubble,
    deleteBubble,
    reorderBubbles,
    acceptFlag,
    dismissFlag,
    revertSourceText,
    revertTranslatedText,
    splitBubble,
    undoBubbleAction,
    redoBubbleAction,

    // Modals and tool state
    isSettingsOpen,
    setIsSettingsOpen,
    toggleSettings,
    isKeyboardOpen,
    setIsKeyboardOpen,
    toggleKeyboard,
    isTypeRModalOpen,
    setIsTypeRModalOpen,
    isDrawBoxActive,
    toggleDrawBox,
    zoomLevel,
    setZoomLevel,
    resetZoom,
    feedFilter,
    setFeedFilter,

    // Queue & Review state
    isScanningActive,
    scanProgressText,
    pageStatuses,
    startBatchScan,
    cancelBatchScan,
    scanSinglePage,
    isReviewingChapter,
    isScanningSinglePage,
    isReviewingSinglePage,
    runChapterReview,
    translateSingleBubble,
    transferText,
  } = useWorkbenchStore();

  const [loadedBlobState, setLoadedBlobState] = useState<{ pageId: string | null; url: string | null }>({
    pageId: null,
    url: null,
  });
  const [isZoomDropdownOpen, setIsZoomDropdownOpen] = useState(false);
  const [exportModalScope, setExportModalScope] = useState<'entire' | 'active'>('entire');
  const [exportModalMode, setExportModalMode] = useState<'raw_text' | 'typer_script'>('raw_text');
  const [isConfirmingExit, setIsConfirmingExit] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [isFlipPageActive, setIsFlipPageActive] = useState(false);
  const [canvasViewResetKey, setCanvasViewResetKey] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null>(null);
  const [centerTarget, setCenterTarget] = useState<{ bubbleId: string; box_2d: [number, number, number, number]; trigger: number } | null>(null);
  const [panTarget, setPanTarget] = useState<{ x: number; y: number; trigger: number } | null>(null);
  const [activeEyeBubbleId, setActiveEyeBubbleId] = useState<string | null>(null);
  const savedViewBeforeEyeRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const prevPageIdRef = useRef<string | null>(null);
  const currentPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pendingFocusRef = useRef<{ bubbleId: string; pageId: string } | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const [deletingPageId, setDeletingPageId] = useState<string | null>(null);
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState(false);

  // Phase 3.1: Original Filename Tooltip State (~1000ms hover delay)
  const [hoveredPageTooltip, setHoveredPageTooltip] = useState<{ fileName: string; x: number; y: number } | null>(null);
  const hoverTooltipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hoverStartCoordRef = useRef<{ x: number; y: number } | null>(null);

  // Phase 3.2: Drag-and-Drop Page Reordering State
  const [pendingPages, setPendingPages] = useState<PageMetadata[] | null>(null);
  const [draggedPageIdx, setDraggedPageIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [saveOrderArmed, setSaveOrderArmed] = useState(false);
  const pendingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isDoubleConfirmEnabled = useConfirmationSetting(folder?.id);

  const pages = chapter?.pageList || [];
  const displayPages = pendingPages || pages;
  const effectivePageId = activePageId || displayPages[0]?.id || null;
  const currentPageIndex = effectivePageId ? displayPages.findIndex((p) => p.id === effectivePageId) : -1;
  const activePageNum = currentPageIndex >= 0 ? currentPageIndex + 1 : 0;

  // Auto-expire pending reorder after 60 seconds if unconfirmed
  useEffect(() => {
    if (pendingPages) {
      pendingTimerRef.current = setTimeout(() => {
        setPendingPages(null);
        setSaveOrderArmed(false);
      }, 60000);
      return () => {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      };
    }
  }, [pendingPages]);

  // Phase 3.1: Filename Tooltip Handlers
  const handlePageTabMouseEnter = (e: React.MouseEvent, fileName: string) => {
    if (hoverTooltipTimerRef.current) clearTimeout(hoverTooltipTimerRef.current);
    const startX = e.clientX;
    const startY = e.clientY;
    hoverStartCoordRef.current = { x: startX, y: startY };
    hoverTooltipTimerRef.current = setTimeout(() => {
      setHoveredPageTooltip({
        fileName,
        x: startX,
        y: startY + 24,
      });
    }, 1000);
  };

  const handlePageTabMouseMove = (e: React.MouseEvent) => {
    if (hoverStartCoordRef.current) {
      const dx = Math.abs(e.clientX - hoverStartCoordRef.current.x);
      const dy = Math.abs(e.clientY - hoverStartCoordRef.current.y);
      if (dx > 15 || dy > 15) {
        if (hoverTooltipTimerRef.current) clearTimeout(hoverTooltipTimerRef.current);
        setHoveredPageTooltip(null);
        hoverStartCoordRef.current = null;
      }
    }
  };

  const handlePageTabMouseLeave = () => {
    if (hoverTooltipTimerRef.current) clearTimeout(hoverTooltipTimerRef.current);
    setHoveredPageTooltip(null);
    hoverStartCoordRef.current = null;
  };

  // Phase 3.2: Reorder Drag & Drop Handlers
  const handleTabDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPageIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleTabDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPageIdx !== null && draggedPageIdx !== index) {
      setDropTargetIdx(index);
    }
  };

  const handleTabDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedPageIdx !== null && draggedPageIdx !== targetIndex) {
      const currentList = [...displayPages];
      const [movedItem] = currentList.splice(draggedPageIdx, 1);
      currentList.splice(targetIndex, 0, movedItem);
      setPendingPages(currentList);
    }
    setDraggedPageIdx(null);
    setDropTargetIdx(null);
  };

  const handleTabDragEnd = () => {
    setDraggedPageIdx(null);
    setDropTargetIdx(null);
  };

  const commitReorderedPages = useCallback(() => {
    if (!pendingPages) return;
    const reindexed = pendingPages.map((p, i) => ({
      ...p,
      index: i + 1,
    }));
    onReorderPages?.(reindexed);
    setPendingPages(null);
    setSaveOrderArmed(false);
  }, [pendingPages, onReorderPages]);

  const handleSaveOrderClick = () => {
    if (!isDoubleConfirmEnabled) {
      commitReorderedPages();
    } else {
      if (saveOrderArmed) {
        commitReorderedPages();
      } else {
        setSaveOrderArmed(true);
      }
    }
  };

  const handleSaveOrderDoubleClick = () => {
    commitReorderedPages();
  };

  const handleCancelReorder = () => {
    setPendingPages(null);
    setSaveOrderArmed(false);
  };

  const hasPrevPage = currentPageIndex > 0;
  const hasNextPage = currentPageIndex >= 0 && currentPageIndex < pages.length - 1;

  const handlePrevPage = () => {
    if (hasPrevPage) {
      setDeletingPageId(null);
      setIsConfirmingExit(false);
      setActivePageId(pages[currentPageIndex - 1].id);
    }
  };

  const handleNextPage = () => {
    if (hasNextPage) {
      setDeletingPageId(null);
      setIsConfirmingExit(false);
      setActivePageId(pages[currentPageIndex + 1].id);
    }
  };

  const handleBackClick = () => {
    if (!isDoubleConfirmEnabled) {
      setIsConfirmingExit(false);
      onBack();
      return;
    }
    if (isConfirmingExit) {
      setIsConfirmingExit(false);
      onBack();
    } else {
      setIsConfirmingExit(true);
    }
  };

  const handleDeletePageClick = (e: React.MouseEvent, pageId: string) => {
    e.stopPropagation();
    if (!isDoubleConfirmEnabled) {
      setDeletingPageId(null);
      onDeletePage?.(pageId);
      return;
    }
    if (deletingPageId === pageId) {
      setDeletingPageId(null);
      onDeletePage?.(pageId);
    } else {
      setDeletingPageId(pageId);
    }
  };

  const handleResetZoom = () => {
    resetZoom();
    setCanvasViewResetKey((k) => k + 1);
  };

  const isLoadingBlob = Boolean(
    effectivePageId &&
    pages.length > 0 &&
    loadedBlobState.pageId !== effectivePageId
  );
  const imageUrl = effectivePageId && loadedBlobState.pageId === effectivePageId ? loadedBlobState.url : null;

  // Hydrate bubbles from IndexedDB
  useEffect(() => {
    if (effectivePageId) {
      loadPageBubbles(effectivePageId);
    }
  }, [effectivePageId, loadPageBubbles]);

  // Close zoom dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setIsZoomDropdownOpen(false);
      }
    };
    if (isZoomDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }
  }, [isZoomDropdownOpen]);

  // Req #3: Reset armed page delete on outside click
  useEffect(() => {
    if (!deletingPageId) return;
    const handleOutsideClick = () => {
      setDeletingPageId(null);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [deletingPageId]);

  // Req #8: Reset canvas zoom & view when switching pages
  useEffect(() => {
    if (effectivePageId && prevPageIdRef.current && prevPageIdRef.current !== effectivePageId) {
      resetZoom();
      setCanvasViewResetKey((k) => k + 1);
      setActiveEyeBubbleId(null);
      savedViewBeforeEyeRef.current = null;
      setFocusTarget(null);
      setCenterTarget(null);
    }
    prevPageIdRef.current = effectivePageId;
  }, [effectivePageId, resetZoom]);

  // Global Keyboard shortcuts: Escape, Ctrl+, Ctrl+K, J, K (focus-guarded)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLInputElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        toggleSettings();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggleKeyboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isInputFocused) {
          e.preventDefault();
          if (e.shiftKey) {
            if (effectivePageId) redoBubbleAction(effectivePageId);
          } else {
            if (effectivePageId) undoBubbleAction(effectivePageId);
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!isInputFocused) {
          e.preventDefault();
          if (effectivePageId) redoBubbleAction(effectivePageId);
        }
      } else if (e.key === 'Escape') {
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else if (isTypeRModalOpen) {
          setIsTypeRModalOpen(false);
        } else if (isKeyboardOpen) {
          setIsKeyboardOpen(false);
        } else {
          onBack();
        }
      } else if (!isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const currentList = effectivePageId ? (bubblesByPage[effectivePageId] || []) : [];
        if (currentList.length > 0) {
          const currentIdx = currentList.findIndex((b) => b.id === selectedBubbleId);

          if (e.key.toLowerCase() === 'j') {
            e.preventDefault();
            const nextIdx = currentIdx < currentList.length - 1 ? currentIdx + 1 : 0;
            setSelectedBubbleId(currentList[nextIdx].id);
          } else if (e.key.toLowerCase() === 'k') {
            e.preventDefault();
            const prevIdx = currentIdx > 0 ? currentIdx - 1 : currentList.length - 1;
            setSelectedBubbleId(currentList[prevIdx].id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isSettingsOpen,
    isTypeRModalOpen,
    isKeyboardOpen,
    toggleSettings,
    toggleKeyboard,
    setIsSettingsOpen,
    setIsTypeRModalOpen,
    setIsKeyboardOpen,
    onBack,
    effectivePageId,
    bubblesByPage,
    selectedBubbleId,
    setSelectedBubbleId,
  ]);

  // Ephemeral Blob URL management with automatic revocation
  useEffect(() => {
    if (!effectivePageId) return;

    let isMounted = true;
    let currentUrl: string | null = null;

    getPageBlob(effectivePageId)
      .then((blob) => {
        if (!isMounted) return;
        if (blob) {
          currentUrl = URL.createObjectURL(blob);
          setLoadedBlobState({ pageId: effectivePageId, url: currentUrl });
        } else {
          setLoadedBlobState({ pageId: effectivePageId, url: null });
        }
      })
      .catch((err) => {
        console.error('Failed to load page blob in workbench', err);
        if (isMounted) {
          setLoadedBlobState({ pageId: effectivePageId, url: null });
        }
      });

    return () => {
      isMounted = false;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [effectivePageId]);

  const currentBubbles = effectivePageId ? (bubblesByPage[effectivePageId] || []) : [];
  const isDraftChapter = folder?.isDraft || folder?.isSystem || chapter?.isDraft;

  // Calculate flagged count
  const flaggedCount = currentBubbles.filter(
    (b) => b.reviewFlags && b.reviewFlags.length > 0
  ).length;

  const handleAddBubbleClick = () => {
    if (effectivePageId) {
      addManualBubble(effectivePageId);
    }
    onAddManualBubble?.();
  };

  const handleAddManualBubbleWithCoords = (box_2d: [number, number, number, number]) => {
    if (effectivePageId) {
      addManualBubble(effectivePageId, box_2d);
    }
  };

  // Scan actions
  const handleScanAll = () => {
    if (isScanningActive) {
      cancelBatchScan();
      return;
    }
    const pageTargets = pages.map((p) => ({ pageId: p.id, pageIndex: p.index }));
    startBatchScan(pageTargets, folder?.id, isDraftChapter);
  };

  const handleScanThisPage = () => {
    if (effectivePageId && !isScanningSinglePage) {
      scanSinglePage(effectivePageId, activePageNum, folder?.id, isDraftChapter);
    }
  };

  const handleReviewChapterClick = async () => {
    if (isReviewingChapter) return;
    const pageTargets = pages.map((p) => ({ pageId: p.id, pageIndex: p.index }));
    try {
      await runChapterReview(chapter?.id || 'chapter-01', pageTargets, folder?.id, isDraftChapter);
    } catch (e: any) {
      alert(`Review Chapter error: ${e?.message || 'QC Audit failed'}`);
    }
  };

  const handleReviewThisPage = async () => {
    if (isReviewingSinglePage || !effectivePageId) return;
    try {
      await runChapterReview(chapter?.id || 'chapter-01', [{ pageId: effectivePageId, pageIndex: activePageNum }], folder?.id, isDraftChapter);
    } catch (e: any) {
      console.error('Review page error:', e);
    }
  };

  const handleExtractPage = () => {
    setExportModalScope('active');
    setExportModalMode('raw_text');
    setIsTypeRModalOpen(true);
    const typerCfg = loadTyperSettings();
    const text = compileRawTextExtract({
      chapterName: chapter?.name || 'CHAPTER 01',
      pages: [{ pageIndex: activePageNum, bubbles: currentBubbles }],
      includePageHeaders: false,
      includeIndexTags: true,
      includePrefixTags: typerCfg.includeTyperSymbols,
      symbolPosition: typerCfg.symbolPosition,
      textDirection: typerCfg.textDirection,
    });
    if (text) {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

  const handleExtractAll = async () => {
    setExportModalScope('entire');
    setExportModalMode('raw_text');
    setIsTypeRModalOpen(true);
    const typerCfg = loadTyperSettings();

    // Ensure all pages have their persisted bubble records loaded from IndexedDB (F-06)
    const completePagesForExport: Array<{ pageIndex: number; bubbles: BubbleItem[] }> = [];
    for (const p of pages) {
      let pageBubbles = bubblesByPage[p.id];
      if (!pageBubbles || pageBubbles.length === 0) {
        try {
          const stored = await getPageBubbles(p.id);
          if (stored && stored.length > 0) {
            pageBubbles = stored;
          }
        } catch (e) {
          console.warn(`[ExtractAll] Could not load persisted bubbles for page ${p.id}:`, e);
        }
      }
      completePagesForExport.push({
        pageIndex: p.index,
        bubbles: pageBubbles || [],
      });
    }

    const text = compileRawTextExtract({
      chapterName: chapter?.name || 'CHAPTER 01',
      pages: completePagesForExport,
      includePageHeaders: true,
      includeIndexTags: true,
      includePrefixTags: typerCfg.includeTyperSymbols,
      symbolPosition: typerCfg.symbolPosition,
      textDirection: typerCfg.textDirection,
    });
    if (text) {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

  const handleTranslateBubble = async (bubbleId: string) => {
    if (effectivePageId) {
      await translateSingleBubble(effectivePageId, bubbleId, folder?.id, isDraftChapter);
    }
  };

  const handleFocusBubble = (bubble: BubbleItem) => {
    if (activeEyeBubbleId === bubble.id) {
      setActiveEyeBubbleId(null);
      setFocusTarget(null);
      if (savedViewBeforeEyeRef.current) {
        setZoomLevel(savedViewBeforeEyeRef.current.zoom);
        setPanTarget({ ...savedViewBeforeEyeRef.current.pan, trigger: Date.now() });
        savedViewBeforeEyeRef.current = null;
      } else {
        resetZoom();
        setCanvasViewResetKey((k) => k + 1);
      }
      return;
    }

    if (!activeEyeBubbleId) {
      savedViewBeforeEyeRef.current = {
        zoom: zoomLevel,
        pan: { ...currentPanRef.current },
      };
    }

    setActiveEyeBubbleId(bubble.id);
    setSelectedBubbleId(bubble.id);

    if (bubble.pageId && bubble.pageId !== effectivePageId) {
      pendingFocusRef.current = { bubbleId: bubble.id, pageId: bubble.pageId };
      setActivePageId(bubble.pageId);
    } else {
      setFocusTarget({
        bubbleId: bubble.id,
        box_2d: bubble.box_2d,
        trigger: Date.now(),
      });
    }
  };

  const handleCardSelectBubble = (bubbleId: string) => {
    setSelectedBubbleId(bubbleId);
    const bubble = currentBubbles.find((b) => b.id === bubbleId);
    if (bubble && bubble.box_2d) {
      setCenterTarget({
        bubbleId: bubble.id,
        box_2d: bubble.box_2d,
        trigger: Date.now(),
      });
    }
  };

  const handleCanvasSelectBubble = (bubbleId: string) => {
    setSelectedBubbleId(bubbleId);
  };

  useEffect(() => {
    if (pendingFocusRef.current && pendingFocusRef.current.pageId === effectivePageId) {
      const bubbleId = pendingFocusRef.current.bubbleId;
      const targetBubble = currentBubbles.find((b) => b.id === bubbleId);
      if (targetBubble) {
        setFocusTarget({
          bubbleId: targetBubble.id,
          box_2d: targetBubble.box_2d,
          trigger: Date.now(),
        });
        pendingFocusRef.current = null;
      }
    }
  }, [effectivePageId, currentBubbles]);

  const handlePickMorePages = async () => {
    try {
      const files = await pickImageFiles();
      if (files.length > 0) {
        const res = await ingestImageFiles(files);
        if (res.pages.length > 0) {
          onAppendPages?.(res.pages);
          if (!activePageId) {
            setActivePageId(res.pages[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Error adding pages', err);
    }
  };

  const handleIngestDroppedOnCanvas = async (droppedFiles: File[]) => {
    try {
      const res = await ingestImageFiles(droppedFiles);
      if (res.pages.length > 0) {
        onAppendPages?.(res.pages);
        if (!activePageId) {
          setActivePageId(res.pages[0].id);
        }
      }
    } catch (err) {
      console.error('Error ingesting dropped files', err);
    }
  };

  const allChapterPagesForExport = pages.map((p) => ({
    pageIndex: p.index,
    bubbles: bubblesByPage[p.id] || [],
  }));

  const zoomOptions = [50, 75, 100, 125, 150, 200, 300, 500, 1000];

  return (
    <div className="flex flex-col h-screen w-screen bg-black text-zinc-100 overflow-hidden font-sans select-none relative">
      {/* 1. Top Bar: Dedicated Page Shelf Crossing the Whole App */}
      <header className="w-full h-12 min-h-[48px] max-h-[48px] bg-black border-b border-white/[0.08] px-4 flex items-center justify-between z-30 shrink-0 select-none gap-4 [-webkit-app-region:drag]">
        {/* Left side: Back to Hub + Page Pills Row stretching across the app */}
        <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar flex-1 py-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={handleBackClick}
            onMouseLeave={() => setIsConfirmingExit(false)}
            className={`h-7 w-14 min-w-[56px] max-w-[56px] rounded-full cursor-pointer shrink-0 inline-flex items-center justify-center text-xs font-semibold select-none transition-colors ${
              isConfirmingExit
                ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
            title={isConfirmingExit ? 'Click again to Exit' : 'Return to Hub (Esc)'}
          >
            {isConfirmingExit ? (
              <span className="whitespace-nowrap select-none pointer-events-none">Exit?</span>
            ) : (
              <ArrowLeft className="w-4 h-4 pointer-events-none" />
            )}
          </button>

          <div className="h-4 w-px bg-white/10 shrink-0" />

          {/* Page Pills with Drag & Drop Reordering + Filename Tooltips */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
            {displayPages.length > 0 ? (
              <>
                {displayPages.map((p, idx) => {
                  const isTabActive = effectivePageId === p.id;
                  const pageNum = p.index || idx + 1;
                  const isPageScanning = pageStatuses[p.id] === 'scanning';
                  const isArmingDelete = deletingPageId === p.id;
                  const isDropTarget = dropTargetIdx === idx && draggedPageIdx !== idx;

                  if (!isTabActive) {
                    return (
                      <button
                        key={p.id}
                        type="button"
                        draggable
                        onDragStart={(e) => handleTabDragStart(e, idx)}
                        onDragOver={(e) => handleTabDragOver(e, idx)}
                        onDrop={(e) => handleTabDrop(e, idx)}
                        onDragEnd={handleTabDragEnd}
                        onMouseEnter={(e) => handlePageTabMouseEnter(e, p.fileName)}
                        onMouseMove={handlePageTabMouseMove}
                        onMouseLeave={handlePageTabMouseLeave}
                        onClick={() => { setDeletingPageId(null); setIsConfirmingExit(false); setActivePageId(p.id); }}
                        className={`relative transition-all duration-150 cursor-pointer inline-flex items-center justify-center w-[76px] min-w-[76px] max-w-[76px] h-8 rounded-full shrink-0 text-xs text-center whitespace-nowrap font-medium ${
                          isDropTarget
                            ? 'border-2 border-sky-400 bg-sky-950/40 text-white shadow-[0_0_12px_rgba(56,189,248,0.3)]'
                            : 'text-zinc-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {isPageScanning && (
                          <span className="absolute left-1.5 w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                        )}
                        <span>Page {pageNum}</span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={(e) => handleTabDragStart(e, idx)}
                      onDragOver={(e) => handleTabDragOver(e, idx)}
                      onDrop={(e) => handleTabDrop(e, idx)}
                      onDragEnd={handleTabDragEnd}
                      onMouseEnter={(e) => handlePageTabMouseEnter(e, p.fileName)}
                      onMouseMove={handlePageTabMouseMove}
                      onMouseLeave={() => {
                        handlePageTabMouseLeave();
                        if (deletingPageId === p.id) {
                          setDeletingPageId(null);
                        }
                      }}
                      className={`relative inline-flex items-center shrink-0 h-8 rounded-full transition-all duration-150 ${
                        isDropTarget
                          ? 'ring-2 ring-sky-400 min-w-[104px]'
                          : ''
                      } ${
                        isArmingDelete
                          ? 'bg-red-500 text-white min-w-[104px]'
                          : 'bg-white text-zinc-950 min-w-[104px]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          if (isArmingDelete) {
                            e.stopPropagation();
                            onDeletePage?.(p.id);
                            setDeletingPageId(null);
                          }
                        }}
                        className={`flex-1 h-full px-3 inline-flex items-center justify-center text-xs font-bold rounded-full text-center whitespace-nowrap relative cursor-grab active:cursor-grabbing ${
                          isArmingDelete ? 'text-white' : 'text-zinc-950'
                        }`}
                      >
                        {isPageScanning && (
                          <span className="absolute left-1.5 w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping pointer-events-none" />
                        )}
                        <span className="pointer-events-none">{isArmingDelete ? 'Delete?' : `Page ${pageNum}`}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeletePageClick(e, p.id)}
                        className={`mr-2 w-4 h-4 rounded-full flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
                          isArmingDelete
                            ? 'bg-white/20 hover:bg-white/40 text-white'
                            : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-950'
                        }`}
                        title={isDoubleConfirmEnabled ? (isArmingDelete ? "Click again to confirm delete" : "Delete page") : "Delete page"}
                      >
                        <X className="w-2.5 h-2.5 stroke-[2.5] pointer-events-none" />
                      </button>
                    </div>
                  );
                })}

                {/* Phase 3.2: Pending Reorder Status Bar */}
                {pendingPages && (
                  <div className="flex items-center gap-2 ml-1 px-2.5 py-0.5 rounded-full bg-sky-950/70 border border-sky-500/40 shadow-sm shrink-0">
                    <span className="text-[11px] text-sky-200 font-semibold uppercase tracking-wider whitespace-nowrap">
                      Pending Order
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveOrderClick}
                      onDoubleClick={handleSaveOrderDoubleClick}
                      onMouseLeave={() => setSaveOrderArmed(false)}
                      className={`px-3 py-0.5 rounded-full text-xs font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap ${
                        saveOrderArmed
                          ? 'bg-amber-400 text-black hover:bg-amber-300 animate-pulse'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                      title={isDoubleConfirmEnabled ? (saveOrderArmed ? "Click again to confirm Save Order" : "Double-click to Save Order") : "Save Order"}
                    >
                      <span className="pointer-events-none">{saveOrderArmed ? 'Confirm Save?' : 'Save Order'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelReorder}
                      className="px-2 py-0.5 rounded-full text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                      title="Cancel reordering and revert"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            ) : (
              <span className="text-xs text-zinc-600 px-2 py-0.5">
                No Pages
              </span>
            )}
          </div>
        </div>

        {/* Right utility actions: Add Page "+", Keyboard, Settings */}
        <div className="flex items-center gap-1.5 shrink-0 [-webkit-app-region:no-drag]">
          {/* Add Page "+" — fixed on the right, unaffected by page pills */}
          <button
            type="button"
            onClick={handlePickMorePages}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Add pages to chapter"
          >
            <Plus className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/10" />

          {isTrainingStudioEnabled() && onOpenTrainingStudio && (
            <button
              type="button"
              onClick={onOpenTrainingStudio}
              className="p-1.5 rounded-full text-xs transition-colors cursor-pointer bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30"
              title="Training Studio (Dev Only)"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsBenchmarkOpen(true)}
            className={`p-1.5 rounded-full text-xs transition-colors cursor-pointer ${
              isBenchmarkOpen ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-500 hover:text-white'
            }`}
            title="Quality Benchmark Engine (System #6)"
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleKeyboard}
            className={`p-1.5 rounded-full text-xs transition-colors cursor-pointer ${
              isKeyboardOpen ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-500 hover:text-white'
            }`}
            title="Toggle Arabic Virtual Keyboard (Ctrl+K)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleSettings}
            className={`p-1.5 rounded-full text-xs transition-colors cursor-pointer ${
              isSettingsOpen ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-500 hover:text-white'
            }`}
            title="Toggle Settings (Ctrl+,)"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 2. Subheader Action Row: Canvas Controls (Left) & Action Pills (Right) */}
      <div className="relative z-30 px-4 py-2 flex items-center justify-between shrink-0 gap-4">
        {/* Left (aligned above Canvas): Zoom Pill + 3 Separated Action Buttons */}
        <div className="w-[32%] max-w-[34%] min-w-[28%] flex items-center gap-2 overflow-visible relative">
          {/* Zoom Percentage & Reset Capsule */}
          <div className="flex items-center gap-1 bg-[#121317] border border-white/[0.08] rounded-xl px-2 py-1 shadow-sm shrink-0">
            {/* Zoom Percentage Dropdown */}
            <ToolbarTooltip
              title="Zoom Level"
              description="Select canvas zoom scale (up to 1000%) or reset to fit"
              align="center"
              disabled={isZoomDropdownOpen}
            >
              <div className="relative" ref={zoomMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsZoomDropdownOpen(!isZoomDropdownOpen)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>{zoomLevel}%</span>
                  <ChevronDown className="w-3 h-3 text-zinc-400" />
                </button>

                {isZoomDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1.5 w-28 rounded-xl bg-[#16171d] border border-white/[0.12] shadow-2xl z-50 py-1 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-100">
                    {zoomOptions.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setZoomLevel(opt);
                          setIsZoomDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs font-sans flex items-center justify-between transition-colors cursor-pointer ${
                          zoomLevel === opt
                            ? 'bg-sky-500/20 text-sky-300 font-semibold'
                            : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                        }`}
                      >
                        <span>{opt}%</span>
                        {opt === 100 && <span className="text-[10px] text-zinc-500">Fit</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </ToolbarTooltip>

            <div className="h-4 w-px bg-white/10 mx-0.5" />

            {/* Reset Zoom */}
            <ToolbarTooltip
              title="Reset Zoom"
              description="Reset zoom scale to 100% and re-center canvas"
              align="center"
            >
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </ToolbarTooltip>
          </div>

          {/* 1. Add Bubble Button (Its own separated button) */}
          <ToolbarTooltip
            title="Add Bubble"
            description="Draw a custom dialogue bounding box on the image canvas (Left-click & drag)"
            align="center"
          >
            <button
              type="button"
              onClick={toggleDrawBox}
              className={`p-2 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isDrawBoxActive 
                  ? 'text-sky-400 bg-sky-500/15 border-sky-500/40' 
                  : 'bg-[#121317] border-white/[0.08] text-zinc-400 hover:text-white hover:bg-[#181920] hover:border-white/[0.16]'
              }`}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
          </ToolbarTooltip>

          {/* 2. Toggle Box View Button (Its own separated button with BoxSelect icon) */}
          <ToolbarTooltip
            title="Toggle Box View"
            description="Show or hide dialogue bounding boxes without removing them"
            align="center"
          >
            <button
              type="button"
              onClick={() => setShowBoxes(!showBoxes)}
              className={`p-2 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                showBoxes 
                  ? 'text-sky-400 bg-sky-500/15 border-sky-500/40' 
                  : 'bg-[#121317] border-white/[0.08] text-zinc-500 hover:text-zinc-300 hover:bg-[#181920] hover:border-white/[0.16]'
              }`}
            >
              {showBoxes ? <BoxSelect className="w-3.5 h-3.5" /> : <SquareDashed className="w-3.5 h-3.5 opacity-50" />}
            </button>
          </ToolbarTooltip>

          {/* 3. Click for Next Page Button (Its own separated button with BookOpen icon) */}
          <ToolbarTooltip
            title="Click for Next Page"
            description="Click outer edges of canvas to flip pages"
            align="center"
          >
            <button
              type="button"
              onClick={() => setIsFlipPageActive(!isFlipPageActive)}
              className={`p-2 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isFlipPageActive 
                  ? 'text-sky-400 bg-sky-500/15 border-sky-500/40' 
                  : 'bg-[#121317] border-white/[0.08] text-zinc-400 hover:text-white hover:bg-[#181920] hover:border-white/[0.16]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          </ToolbarTooltip>
        </div>

        {/* Subheader Actions: Page actions grouped and aligned on the right of the page toolbar area; Batch actions at far right */}
        <div className="flex-1 flex items-center justify-between gap-2 overflow-x-auto py-0.5 custom-scrollbar">
          {/* Phase 4.1: Page Actions Group — Scan Page | Review Page | Extract Page */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleScanThisPage}
              disabled={isScanningSinglePage}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isScanningSinglePage
                  ? 'bg-[#181920] border-sky-500/40 text-sky-300 animate-pulse'
                  : 'bg-[#121317] border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-zinc-200'
              }`}
              title="Scan Current Page OCR & Translate"
            >
              {isScanningSinglePage ? (
                <svg className="w-3.5 h-3.5 animate-spin text-sky-300" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
              )}
              <span>Scan Page</span>
            </button>

            <button
              type="button"
              onClick={handleReviewThisPage}
              disabled={isReviewingSinglePage}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isReviewingSinglePage
                  ? 'bg-[#181920] border-amber-400/40 text-amber-300 animate-pulse'
                  : 'bg-[#121317] border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-zinc-200'
              }`}
              title={flaggedCount > 0 ? `Review Page (${flaggedCount} flags)` : "Review Page"}
            >
              {isReviewingSinglePage ? (
                <svg className="w-3.5 h-3.5 animate-spin text-amber-300" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <Search className="w-3.5 h-3.5 text-zinc-300" />
              )}
              <span>Review Page</span>
            </button>

            <button
              type="button"
              onClick={handleExtractPage}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#121317] border border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-xs font-medium text-zinc-200 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
              title="Extract Current Page Text (No Translation)"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-300" />
              <span>Extract Page</span>
            </button>
          </div>

          {/* Phase 4.1: Batch Actions Group — Extract All | Review All | Scan All at the far right */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExtractAll}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#121317] border border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-xs font-medium text-zinc-200 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
              title="Extract All Chapter Text (No Translation)"
            >
              <FileText className="w-3.5 h-3.5 text-zinc-300" />
              <span>Extract All</span>
            </button>

            <button
              type="button"
              onClick={handleReviewChapterClick}
              disabled={isReviewingChapter}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isReviewingChapter
                  ? 'bg-amber-300 text-black animate-pulse'
                  : 'bg-amber-400 hover:bg-amber-300 text-black'
              }`}
              title="Review Entire Chapter"
            >
              {isReviewingChapter ? (
                <svg className="w-3.5 h-3.5 animate-spin text-black" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Review All</span>
            </button>

            <button
              type="button"
              onClick={handleScanAll}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                isScanningActive
                  ? 'bg-blue-400 text-white animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
              title="Batch Scan Entire Chapter"
            >
              {isScanningActive ? (
                <svg className="w-3.5 h-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isScanningActive && scanProgressText ? scanProgressText : 'Scan All'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Split View: Left Canvas Pane & Right Dialogue Feed */}
      <div className="flex-1 min-h-0 w-full flex flex-row overflow-hidden px-4 pb-4 gap-4">
        {/* Left Column: Canvas Card Container */}
        <div className="w-[32%] max-w-[34%] min-w-[28%] h-full flex flex-col min-h-0">
          <CanvasPane
            imageUrl={imageUrl}
            isLoading={isLoadingBlob}
            pageFileName={pages[currentPageIndex]?.fileName}
            bubbles={currentBubbles}
            selectedBubbleId={selectedBubbleId}
            focusTarget={focusTarget}
            centerTarget={centerTarget}
            panTarget={panTarget}
            isDrawBoxActive={isDrawBoxActive}
            zoomLevel={zoomLevel}
            showBoxes={showBoxes}
            isFlipPageActive={isFlipPageActive}
            hasPrevPage={hasPrevPage}
            hasNextPage={hasNextPage}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onZoomChange={setZoomLevel}
            onResetZoom={handleResetZoom}
            resetViewTrigger={canvasViewResetKey}
            onPanChange={(p) => { currentPanRef.current = p; }}
            onSelectBubble={handleCanvasSelectBubble}
            onAddManualBubbleWithCoords={handleAddManualBubbleWithCoords}
            onIngestDroppedFiles={handleIngestDroppedOnCanvas}
          />
        </div>

        {/* Right Column: Dialogue Feed */}
        <div className="flex-1 h-full flex flex-col min-h-0">
          <FeedPane
            bubbles={currentBubbles}
            selectedBubbleId={selectedBubbleId}
            activeEyeBubbleId={activeEyeBubbleId}
            feedFilter={feedFilter}
            onSelectBubble={handleCardSelectBubble}
            onTransferText={(params) => {
              if (effectivePageId) {
                transferText(effectivePageId, params);
              }
            }}
            onFocusBubble={handleFocusBubble}
            onUpdateBubble={(bubbleId, patch) => {
              if (effectivePageId) {
                updateBubble(effectivePageId, bubbleId, patch);
              }
            }}
            onDeleteBubble={(bubbleId) => {
              if (effectivePageId) {
                deleteBubble(effectivePageId, bubbleId);
              }
            }}
            onSplitBubble={(bubbleId, splitIndex) => {
              if (effectivePageId) {
                splitBubble(effectivePageId, bubbleId, splitIndex);
              }
            }}
            onTranslateBubble={handleTranslateBubble}
            onAcceptFlag={(bubbleId, flagId) => {
              if (effectivePageId) {
                acceptFlag(effectivePageId, bubbleId, flagId);
              }
            }}
            onDismissFlag={(bubbleId, flagId) => {
              if (effectivePageId) {
                dismissFlag(effectivePageId, bubbleId, flagId);
              }
            }}
            onRevertSource={(bubbleId) => {
              if (effectivePageId) {
                revertSourceText(effectivePageId, bubbleId);
              }
            }}
            onRevertTranslation={(bubbleId) => {
              if (effectivePageId) {
                revertTranslatedText(effectivePageId, bubbleId);
              }
            }}
            onAddManualBubble={handleAddBubbleClick}
            onReorderBubbles={(startIndex, endIndex) => {
              if (effectivePageId) {
                reorderBubbles(effectivePageId, startIndex, endIndex);
              }
            }}
            onSetFeedFilter={setFeedFilter}
          />
        </div>
      </div>

      {/* 4. System #6 Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenBenchmark={() => setIsBenchmarkOpen(true)}
        projectId={folder?.id}
      />

      {/* System #6 Quality Benchmark Screen */}
      <BenchmarkScreen
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
      />

      {/* 5. TypeR / Text Export Modal */}
      <TypeRModal
        key={`${isTypeRModalOpen ? 1 : 0}-${exportModalScope}-${exportModalMode}`}
        isOpen={isTypeRModalOpen}
        onClose={() => setIsTypeRModalOpen(false)}
        bubbles={currentBubbles}
        allChapterPages={allChapterPagesForExport}
        chapterName={chapter?.name || 'CHAPTER 01'}
        activePageIndex={activePageNum}
        initialScope={exportModalScope}
        initialMode={exportModalMode}
      />

      {/* 6. Floating Resizable Virtual Keyboard */}
      <VirtualKeyboard
        isOpen={isKeyboardOpen}
        onClose={() => setIsKeyboardOpen(false)}
      />

      {/* Phase 3.1: Original Filename Tooltip (~1000ms delay) */}
      {hoveredPageTooltip && (
        <div
          style={{ left: `${hoveredPageTooltip.x}px`, top: `${hoveredPageTooltip.y}px` }}
          className="fixed z-50 pointer-events-none -translate-x-1/2 px-2.5 py-1 rounded-lg bg-[#121318] border border-white/[0.14] text-xs text-zinc-200 font-mono shadow-2xl animate-in fade-in duration-150"
        >
          <span className="text-[10px] text-zinc-500 mr-1.5 uppercase font-sans">Source:</span>
          <span>{hoveredPageTooltip.fileName}</span>
        </div>
      )}
    </div>
  );
};
