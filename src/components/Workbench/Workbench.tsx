import React, { useState, useEffect, useRef } from 'react';
import type { Folder, Chapter } from '../../types';
import { useWorkbenchStore } from '../../store/workbenchStore';
import { getPageBlob } from '../../services/db';
import { CanvasPane } from './CanvasPane';
import { FeedPane } from './FeedPane';
import { SettingsDrawer } from '../Settings/SettingsDrawer';
import { VirtualKeyboard } from '../Tools/VirtualKeyboard';
import { TypeRModal } from '../Export/TypeRModal';
import { ingestImageFiles, pickImageFiles } from '../../services/fileIngestion';
import { compileRawTextExtract } from '../../lib/compileTypeR';
import { 
  ArrowLeft, 
  Menu, 
  FileText, 
  Keyboard,
  Search,
  RotateCcw,
  ChevronDown,
  Copy,
  Check,
  Plus,
  Sparkles
} from 'lucide-react';

interface WorkbenchProps {
  folder: Folder | null;
  chapter: Chapter | null;
  onBack: () => void;
  onAddManualBubble?: () => void;
  onAppendPages?: (newPages: any[]) => void;
}

export const Workbench: React.FC<WorkbenchProps> = ({
  folder,
  chapter,
  onBack,
  onAddManualBubble,
  onAppendPages,
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
  } = useWorkbenchStore();

  const [loadedBlobState, setLoadedBlobState] = useState<{ pageId: string | null; url: string | null }>({
    pageId: null,
    url: null,
  });
  const [isZoomDropdownOpen, setIsZoomDropdownOpen] = useState(false);
  const [exportModalScope, setExportModalScope] = useState<'entire' | 'active'>('entire');
  const [exportModalMode, setExportModalMode] = useState<'raw_text' | 'typer_script'>('raw_text');
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  const pages = chapter?.pageList || [];
  const effectivePageId = activePageId || pages[0]?.id || null;
  const currentPageIndex = effectivePageId ? pages.findIndex((p) => p.id === effectivePageId) : -1;
  const activePageNum = currentPageIndex >= 0 ? currentPageIndex + 1 : 0;

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
    const text = compileRawTextExtract({
      chapterName: chapter?.name || 'CHAPTER 01',
      pages: [{ pageIndex: activePageNum, bubbles: currentBubbles }],
      includePageHeaders: false,
      includeIndexTags: true,
    });
    if (text) {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

  const handleExtractAll = () => {
    setExportModalScope('entire');
    setExportModalMode('raw_text');
    setIsTypeRModalOpen(true);
    const text = compileRawTextExtract({
      chapterName: chapter?.name || 'CHAPTER 01',
      pages: allChapterPagesForExport,
      includePageHeaders: true,
      includeIndexTags: true,
    });
    if (text) {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  };

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

  const zoomOptions = [50, 75, 100, 125, 150, 200];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#060709] text-zinc-100 overflow-hidden font-sans select-none relative">
      {/* 1. Top Bar: Dedicated Page Shelf Crossing the Whole App */}
      <header className="w-full h-12 min-h-[48px] max-h-[48px] bg-[#0c0d11] border-b border-white/[0.08] px-4 flex items-center justify-between z-30 shrink-0 select-none gap-4">
        {/* Left side: Back to Hub + Page Pills Row stretching across the app */}
        <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar flex-1 py-1">
          <button
            onClick={onBack}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Return to Hub (Esc)"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-white/10 shrink-0" />

          {/* Page Pills: 01, 02, 03... fixed-width so active state doesn't shift siblings */}
          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
            {pages.length > 0 ? (
              <>
                {pages.map((p, idx) => {
                  const isTabActive = effectivePageId === p.id;
                  const paddedIndex = String(p.index || idx + 1).padStart(2, '0');
                  const isPageScanning = pageStatuses[p.id] === 'scanning';

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActivePageId(p.id)}
                      className={`transition-all duration-150 cursor-pointer flex items-center justify-center gap-1 w-10 py-1 rounded-full shrink-0 text-xs ${
                        isTabActive
                          ? 'bg-white text-zinc-950 font-bold shadow-sm'
                          : 'text-zinc-400 hover:text-white hover:bg-white/5 font-medium'
                      }`}
                    >
                      {isPageScanning && (
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
                      )}
                      <span>{paddedIndex}</span>
                    </button>
                  );
                })}
              </>
            ) : (
              <span className="text-xs text-zinc-600 px-2 py-0.5">
                No Pages
              </span>
            )}
          </div>
        </div>

        {/* Right utility actions: Add Page "+", Keyboard, Settings */}
        <div className="flex items-center gap-1.5 shrink-0">
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
      <div className="px-4 py-2 flex items-center justify-between shrink-0 gap-4">
        {/* Left (aligned above Canvas): Zoom & Fit Capsule */}
        <div className="w-[32%] max-w-[34%] min-w-[28%] flex items-center">
          <div className="flex items-center gap-1.5 bg-[#121317] border border-white/[0.08] rounded-xl px-2.5 py-1 shadow-sm">
            {/* Search / Magnifier */}
            <button
              type="button"
              onClick={toggleDrawBox}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                isDrawBoxActive ? 'text-sky-400 bg-sky-500/15' : 'text-zinc-400 hover:text-white'
              }`}
              title="Toggle Box Draw / Inspect Mode"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            {/* Zoom Percentage Dropdown */}
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
                <div className="absolute left-0 top-full mt-1.5 w-28 rounded-xl bg-[#16171d] border border-white/[0.12] shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
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

            {/* Rotate / Reset Zoom */}
            <button
              type="button"
              onClick={resetZoom}
              className="p-1 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Reset Zoom to 100%"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right (aligned above Feed): Page tools LEFT side, All tools RIGHT side — separated */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto py-0.5 custom-scrollbar">
          {/* Group 1: Single Page Tools — left-aligned */}
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
              <FileText className="w-3.5 h-3.5 text-zinc-300" />
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
              <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
            )}
            <span>Review Page</span>
          </button>

          <button
            type="button"
            onClick={handleExtractPage}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#121317] border border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-xs font-medium text-zinc-200 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
            title="Extract Current Page Text (No Translation)"
          >
            <span className="border border-zinc-400 px-1 py-0.2 rounded text-[10px] font-bold leading-none">A</span>
            <span>Extract Page</span>
          </button>

          {/* Flexible gap to push "All" group to the right */}
          <div className="flex-1" />

          {/* Group 2: Chapter / All Tools — Scan All (blue) | Review All (amber) | Extract All */}
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
            <Copy className="w-3.5 h-3.5" />
            <span>{isScanningActive && scanProgressText ? scanProgressText : 'Scan All'}</span>
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
            <Check className="w-3.5 h-3.5" />
            <span>{isReviewingChapter ? 'Reviewing...' : 'Review All'}</span>
          </button>

          <button
            type="button"
            onClick={handleExtractAll}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#121317] border border-white/[0.08] hover:bg-[#181920] hover:border-white/[0.16] text-xs font-medium text-zinc-200 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
            title="Extract All Chapter Text (No Translation)"
          >
            <span className="border border-zinc-400 px-1 py-0.2 rounded text-[10px] font-bold leading-none">A</span>
            <span>Extract All</span>
          </button>
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
            isDrawBoxActive={isDrawBoxActive}
            zoomLevel={zoomLevel}
            onSelectBubble={setSelectedBubbleId}
            onAddManualBubbleWithCoords={handleAddManualBubbleWithCoords}
            onIngestDroppedFiles={handleIngestDroppedOnCanvas}
          />
        </div>

        {/* Right Column: Dialogue Feed */}
        <div className="flex-1 h-full flex flex-col min-h-0">
          <FeedPane
            bubbles={currentBubbles}
            selectedBubbleId={selectedBubbleId}
            feedFilter={feedFilter}
            onSelectBubble={setSelectedBubbleId}
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

      {/* 4. Sliding Hardware Settings Drawer */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
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
    </div>
  );
};
