import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Folder } from '../../../types';
import { chapterAcquisitionManager } from '../services/acquisitionManager';
import { ChapterSourceResolver } from '../services/sourceResolver';
import { ChapterZipExporter } from '../services/zipExporter';
import { ChapterWorkspaceImporter } from '../services/workspaceImporter';
import { PageThumbnailCard } from './PageThumbnailCard';
import type { ChapterAcquisition, ChapterSource } from '../types';
import {
  X,
  Download,
  FolderInput,
  Archive,
  RotateCcw,
  AlertCircle,
  CheckCheck,
  XCircle,
  Loader2,
  Globe,
  ArrowRight,
} from 'lucide-react';

interface ChapterSnatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeFolder: Folder | null;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  openChapter: (chapterId: string, folderId?: string | null, pageId?: string | null) => void;
  showToast?: (msg: string) => void;
  setActiveFolderId?: (folderId: string | null) => void;
  setSelectedChapterId?: (chapterId: string | null) => void;
}

export const ChapterSnatchModal: React.FC<ChapterSnatchModalProps> = ({
  isOpen,
  onClose,
  activeFolder,
  folders,
  setFolders,
  openChapter,
  showToast,
  setActiveFolderId,
  setSelectedChapterId,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [acquisition, setAcquisition] = useState<ChapterAcquisition>(() =>
    chapterAcquisitionManager.getSnapshot()
  );
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isImportingWorkspace, setIsImportingWorkspace] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Subscribe to acquisition manager updates & auto-select ready pages
  useEffect(() => {
    const unsub = chapterAcquisitionManager.subscribe((newAcq) => {
      setAcquisition(newAcq);
      if (newAcq.errorMessage) {
        setErrorMessage(newAcq.errorMessage);
      }
      if (newAcq.pages.length > 0) {
        setSelectedPageIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const p of newAcq.pages) {
            if (p.downloadStatus === 'ready' && !prev.has(p.id)) {
              next.add(p.id);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    });
    return () => unsub();
  }, []);

  // Realtime source detection on typing
  const detectedSource: ChapterSource | null = useMemo(() => {
    if (!urlInput.trim()) return null;
    return ChapterSourceResolver.detectSource(urlInput);
  }, [urlInput]);

  const handleFetch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setErrorMessage(null);
    setSelectedPageIds(new Set());

    try {
      await chapterAcquisitionManager.fetchAndAcquire(urlInput.trim());
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to fetch chapter.');
    }
  };

  const handleSelectAll = () => {
    const allReady = new Set(
      acquisition.pages.filter((p) => p.downloadStatus === 'ready').map((p) => p.id)
    );
    setSelectedPageIds(allReady);
  };

  const handleDeselectAll = () => {
    setSelectedPageIds(new Set());
  };

  const handleTogglePage = useCallback((pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  const handleRetryFailed = async () => {
    setErrorMessage(null);
    try {
      await chapterAcquisitionManager.retryFailedPages();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Retry failed.');
    }
  };

  // Selected pages in original sequential order
  const selectedPagesList = useMemo(() => {
    return acquisition.pages
      .filter((p) => selectedPageIds.has(p.id) && p.downloadStatus === 'ready')
      .sort((a, b) => a.originalIndex - b.originalIndex);
  }, [acquisition.pages, selectedPageIds]);

  const selectedCount = selectedPagesList.length;
  const isBusy =
    acquisition.status === 'fetching' ||
    acquisition.status === 'downloading' ||
    isExportingZip ||
    isImportingWorkspace;

  // Destination Action 1: Save as ZIP
  const handleSaveZip = async () => {
    if (selectedCount === 0 || isBusy) return;
    setIsExportingZip(true);
    setErrorMessage(null);

    try {
      const defaultName = ChapterZipExporter.buildArchiveFilename(
        acquisition.metadata?.seriesTitle,
        acquisition.metadata?.chapterNumber
      );

      const res = await ChapterZipExporter.exportSelectedPagesToZip(
        selectedPagesList,
        chapterAcquisitionManager.getAllImages(),
        defaultName
      );

      if (res.saved) {
        showToast?.(`ZIP exported successfully (${selectedCount} pages)`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to export ZIP archive.');
    } finally {
      setIsExportingZip(false);
    }
  };

  // Destination Action 2: Move to Workspace
  const handleMoveToWorkspace = async () => {
    if (selectedCount === 0 || isBusy) return;
    setIsImportingWorkspace(true);
    setErrorMessage(null);

    try {
      const result = await ChapterWorkspaceImporter.importPagesToWorkspace({
        selectedPages: selectedPagesList,
        imageMap: chapterAcquisitionManager.getAllImages(),
        metadata: acquisition.metadata,
        targetFolder: activeFolder,
        folders,
        setFolders,
        openChapter,
        setActiveFolderId,
        setSelectedChapterId,
      });

      if (result.success) {
        showToast?.(`Imported "${result.chapterName}" (${result.pageCount} pages)`);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import into Workspace.');
    } finally {
      setIsImportingWorkspace(false);
    }
  };

  const handleClose = () => {
    if (acquisition.status === 'fetching' || acquisition.status === 'downloading') {
      chapterAcquisitionManager.cancel();
    }
    onClose();
  };

  if (!isOpen) return null;

  const hasManifest = acquisition.pages.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-5xl h-[88vh] bg-[#0c0d12] border border-white/[0.12] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 font-sans animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-14 px-6 border-b border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-zinc-800 border border-white/[0.08] text-white">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-wider uppercase text-zinc-100">
                  Chapter Snatch
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-zinc-400 border border-white/[0.06]">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Acquire chapters from MangaDex and Asura Scans directly into Folio Script.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Screen A: Fetch Strip */}
        <div className="px-6 py-3 bg-[#0a0a0e] border-b border-white/[0.06] flex items-center gap-3 shrink-0">
          <form onSubmit={handleFetch} className="flex-1 flex items-center gap-3">
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste chapter URL (e.g., https://mangadex.org/chapter/... or https://asurascans.com/...)"
                className="w-full h-9 pl-3 pr-28 rounded-xl bg-zinc-900 border border-white/[0.12] text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/30 transition-colors"
                disabled={isBusy}
              />

              {/* Source Indicator Pill */}
              <div className="absolute right-2 flex items-center pointer-events-none">
                {detectedSource === 'mangadex' && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                    MangaDex
                  </span>
                )}
                {detectedSource === 'asura' && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                    Asura Scans
                  </span>
                )}
                {!detectedSource && urlInput.trim() && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono text-zinc-500 bg-zinc-800 border border-white/[0.06]">
                    Detecting
                  </span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={isBusy || !urlInput.trim()}
              className={`h-9 px-4 rounded-xl text-xs font-mono font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                isBusy || !urlInput.trim()
                  ? 'bg-zinc-800 text-zinc-500 border border-white/[0.04] cursor-not-allowed'
                  : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] cursor-pointer shadow-sm'
              }`}
            >
              {acquisition.status === 'fetching' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Fetching...</span>
                </>
              ) : acquisition.status === 'downloading' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    Downloading {acquisition.completedCount}/{acquisition.totalCount}
                  </span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>Fetch Chapter</span>
                </>
              )}
            </button>
          </form>

          {isBusy && (
            <button
              type="button"
              onClick={() => chapterAcquisitionManager.cancel()}
              className="h-9 px-3 rounded-xl text-xs font-mono text-zinc-400 hover:text-white hover:bg-white/10 border border-white/[0.08] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Error Feedback Banner */}
        {errorMessage && (
          <div className="px-6 py-2.5 bg-rose-950/40 border-b border-rose-500/30 flex items-center justify-between text-xs text-rose-300 font-mono shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            {acquisition.failedCount > 0 && (
              <button
                type="button"
                onClick={handleRetryFailed}
                className="px-2 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry Failed ({acquisition.failedCount})</span>
              </button>
            )}
          </div>
        )}

        {/* Screen B: Chapter Metadata & Page Selection Header */}
        {hasManifest && (
          <div className="px-6 py-2.5 bg-[#090a0d] border-b border-white/[0.06] flex items-center justify-between shrink-0 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white tracking-tight">
                  {acquisition.metadata?.seriesTitle || 'Unknown Series'}
                </h4>
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                  {acquisition.metadata?.chapterNumber && (
                    <span>Chapter {acquisition.metadata.chapterNumber}</span>
                  )}
                  {acquisition.metadata?.chapterTitle && (
                    <span className="text-zinc-500">• {acquisition.metadata.chapterTitle}</span>
                  )}
                  <span className="text-zinc-600">({acquisition.totalCount} pages)</span>
                </div>
              </div>
            </div>

            {/* Selection Controls */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-400 mr-2">
                Selected: <strong className="text-white">{selectedCount}</strong> /{' '}
                {acquisition.totalCount}
              </span>

              <button
                type="button"
                onClick={handleSelectAll}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                title="Select all pages"
              >
                <CheckCheck className="w-3.5 h-3.5 text-zinc-400" />
                <span>Select All</span>
              </button>

              <button
                type="button"
                onClick={handleDeselectAll}
                className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                title="Deselect all pages"
              >
                <XCircle className="w-3.5 h-3.5 text-zinc-400" />
                <span>Deselect All</span>
              </button>

              {acquisition.failedCount > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-mono text-rose-300 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry ({acquisition.failedCount})</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Thumbnail Grid Area */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#0a0a0d]">
          {!hasManifest ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center mb-4 text-zinc-500">
                <Download className="w-6 h-6 stroke-[1.5]" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-1">Paste a chapter link to start</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-4">
                Enter a chapter URL from MangaDex or Asura Scans above. Folio Script will automatically
                retrieve the page list and original-quality images.
              </p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-600">
                <span>Supported:</span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06]">
                  mangadex.org
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06]">
                  asurascans.com
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pb-6">
              {acquisition.pages.map((page) => (
                <PageThumbnailCard
                  key={page.id}
                  page={page}
                  isSelected={selectedPageIds.has(page.id)}
                  onToggleSelect={handleTogglePage}
                  onRetrySingle={handleRetryFailed}
                />
              ))}
            </div>
          )}
        </div>

        {/* Screen C: Destination Action Footer */}
        <div className="h-16 px-6 border-t border-white/[0.08] bg-[#08080b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
            {hasManifest && (
              <span>
                Destination: {activeFolder ? `Project "${activeFolder.name}"` : 'Drafts Folder'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Primary Action 1: Save as ZIP */}
            <button
              type="button"
              onClick={handleSaveZip}
              disabled={selectedCount === 0 || isBusy}
              className={`h-9 px-4 rounded-xl text-xs font-mono font-medium flex items-center gap-2 transition-all ${
                selectedCount === 0 || isBusy
                  ? 'bg-zinc-900 text-zinc-600 border border-white/[0.04] cursor-not-allowed'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-white/[0.12] cursor-pointer'
              }`}
              title="Save selected pages as a standard ZIP archive"
            >
              {isExportingZip ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              <span>Save as ZIP ({selectedCount})</span>
            </button>

            {/* Primary Action 2: Move to Workspace */}
            <button
              type="button"
              onClick={handleMoveToWorkspace}
              disabled={selectedCount === 0 || isBusy}
              className={`h-9 px-4 rounded-xl text-xs font-mono font-semibold flex items-center gap-2 transition-all ${
                selectedCount === 0 || isBusy
                  ? 'bg-zinc-800 text-zinc-500 border border-white/[0.04] cursor-not-allowed'
                  : 'bg-white text-zinc-950 hover:bg-zinc-200 active:scale-[0.98] cursor-pointer shadow-md'
              }`}
              title="Import selected pages directly into Folio Script Workspace"
            >
              {isImportingWorkspace ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-950" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <FolderInput className="w-3.5 h-3.5 text-zinc-950" />
                  <span>Move to Workspace ({selectedCount})</span>
                  <ArrowRight className="w-3 h-3 text-zinc-950" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
