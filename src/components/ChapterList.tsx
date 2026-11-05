import React, { useState, useRef } from 'react';
import type { Chapter, SortMode, Folder, PageMetadata } from '../types';
import { 
  ArrowUpDown, 
  Plus, 
  Pencil, 
  Trash2, 
  FileText, 
  Check, 
  ChevronDown,
  FolderOpen,
  Eye,
  UploadCloud
} from 'lucide-react';
import { Modal } from './Modal';
import { PageThumbnail } from './PageThumbnail';
import { PageImageViewer } from './PageImageViewer';
import { formatDraftName, extractFilesFromDataTransfer } from '../services/fileIngestion';
import { useWorkbenchStore } from '../store/workbenchStore';

interface ChapterListProps {
  activeFolder: Folder | null;
  selectedChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  onOpenChapter?: (chapter: Chapter) => void;
  onAddChapter: (name: string) => void;
  onAddChapterWithFiles?: (name: string, files: File[]) => void;
  onAddImagesToChapter: (chapter: Chapter, files?: File[]) => void;
  onRenameChapter: (id: string, newName: string) => void;
  onDeleteChapter: (id: string) => void;
  onDeletePageFromChapter: (chapterId: string, pageId: string) => void;
  onReorderPages: (chapterId: string, updatedPageList: PageMetadata[]) => void;
  onShowPages?: (chapter: Chapter) => void;
}

export const ChapterList: React.FC<ChapterListProps> = ({
  activeFolder,
  selectedChapterId,
  onSelectChapter,
  onOpenChapter,
  onAddChapter,
  onAddChapterWithFiles,
  onAddImagesToChapter,
  onRenameChapter,
  onDeleteChapter,
  onDeletePageFromChapter,
  onReorderPages,
  onShowPages,
}) => {
  const { openChapter } = useWorkbenchStore();
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [isSortOpen, setIsSortOpen] = useState(false);

  // OS Drag and Drop state
  const [isOsDragOver, setIsOsDragOver] = useState(false);
  const [dropTargetChapterId, setDropTargetChapterId] = useState<string | null>(null);

  // Add Chapter Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');

  // Show Pages state
  const [viewingChapterId, setViewingChapterId] = useState<string | null>(null);

  // Fullscreen Page Viewer state
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState<number | null>(null);

  // Drag and drop reordering state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [localPages, setLocalPages] = useState<PageMetadata[]>([]);
  const hasDraggedRef = useRef(false);

  // Rename Chapter Modal state
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm state
  const [deletingChapter, setDeletingChapter] = useState<Chapter | null>(null);

  const chapters = activeFolder ? activeFolder.chapters : [];
  const isFolderSelected = activeFolder !== null;
  const isDraftsFolder = activeFolder?.isSystem === true || activeFolder?.isDraft === true;

  const viewingChapter = chapters.find((c) => c.id === viewingChapterId) || null;
  const displayPages = draggedId ? localPages : (viewingChapter?.pageList || []);

  const handleChapterClick = (chapter: Chapter) => {
    onSelectChapter(chapter.id);
    const firstPageId = chapter.pageList?.[0]?.id || null;
    openChapter(chapter.id, activeFolder?.id, firstPageId);
    onOpenChapter?.(chapter);
  };

  // Sorting logic
  const sortedChapters = [...chapters].sort((a, b) => {
    switch (sortMode) {
      case 'alphabetical-asc':
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'alphabetical-desc':
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      case 'newest':
        return b.createdAt - a.createdAt;
      case 'oldest':
        return a.createdAt - b.createdAt;
      case 'pages-desc':
        return b.pages - a.pages;
      case 'pages-asc':
        return a.pages - b.pages;
      default:
        return 0;
    }
  });

  const handleOpenShowPages = (chapter: Chapter, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewingChapterId(chapter.id);
    onShowPages?.(chapter);
  };

  const handleDeletePage = (pageId: string) => {
    if (!viewingChapterId) return;
    onDeletePageFromChapter(viewingChapterId, pageId);
  };

  // Drag and drop reordering handlers
  const handleDragStart = (e: React.DragEvent, pageId: string) => {
    setDraggedId(pageId);
    setLocalPages(viewingChapter?.pageList || []);
    hasDraggedRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pageId);
  };

  const handleDragEnter = (targetPageId: string) => {
    if (!draggedId || draggedId === targetPageId) return;

    setLocalPages((prev) => {
      const draggedIdx = prev.findIndex((p) => p.id === draggedId);
      const targetIdx = prev.findIndex((p) => p.id === targetPageId);
      if (draggedIdx === -1 || targetIdx === -1) return prev;

      const updated = [...prev];
      const [movedItem] = updated.splice(draggedIdx, 1);
      updated.splice(targetIdx, 0, movedItem);

      return updated.map((p, idx) => ({ ...p, index: idx + 1 }));
    });
  };

  const handleDragEnd = () => {
    if (viewingChapterId && localPages.length > 0) {
      onReorderPages(viewingChapterId, localPages);
    }
    setDraggedId(null);
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 80);
  };

  const handleOpenAdd = () => {
    if (!isFolderSelected) return;

    if (isDraftsFolder) {
      setNewChapterName(formatDraftName());
    } else {
      const numbers: number[] = [];
      chapters.forEach((c) => {
        const matches = c.name.match(/\d+/g);
        if (matches) {
          matches.forEach((m) => numbers.push(parseInt(m, 10)));
        }
      });
      const highestNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      setNewChapterName(`chapter ${highestNumber + 1}`);
    }

    setIsAddOpen(true);
  };

  const handleCreateChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterName.trim()) return;
    onAddChapter(newChapterName.trim());
    setIsAddOpen(false);
  };

  const handleOpenRename = (chapter: Chapter, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChapter(chapter);
    setRenameValue(chapter.name);
  };

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChapter || !renameValue.trim()) return;
    onRenameChapter(editingChapter.id, renameValue.trim());
    setEditingChapter(null);
  };

  const handleOpenDelete = (chapter: Chapter, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingChapter(chapter);
  };

  const handleConfirmDelete = () => {
    if (deletingChapter) {
      onDeleteChapter(deletingChapter.id);
      setDeletingChapter(null);
    }
  };

  // OS Native Drag & Drop Handlers
  const handleListDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsOsDragOver(true);
    }
  };

  const handleListDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOsDragOver(false);
    setDropTargetChapterId(null);
  };

  const handleListDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOsDragOver(false);
    const targetId = dropTargetChapterId;
    setDropTargetChapterId(null);

    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;

      if (targetId) {
        const targetChapter = chapters.find((c) => c.id === targetId);
        if (targetChapter) {
          onAddImagesToChapter(targetChapter, files);
          return;
        }
      }

      // Dropped on empty area: create new chapter
      if (onAddChapterWithFiles) {
        const defaultName = isDraftsFolder ? formatDraftName() : `chapter ${chapters.length + 1}`;
        onAddChapterWithFiles(defaultName, files);
      } else if (chapters.length > 0) {
        // Fallback: append to first chapter
        onAddImagesToChapter(chapters[0], files);
      }
    } catch (err) {
      console.error('Failed to ingest dropped files onto ChapterList', err);
    }
  };

  const sortLabels: Record<SortMode, string> = {
    'alphabetical-asc': 'Alphabetical (A - Z)',
    'alphabetical-desc': 'Alphabetical (Z - A)',
    'newest': 'Newest first',
    'oldest': 'Oldest first',
    'pages-desc': 'Most pages',
    'pages-asc': 'Least pages',
  };

  return (
    <div
      onDragOver={handleListDragOver}
      onDragLeave={handleListDragLeave}
      onDrop={handleListDrop}
      className={`flex flex-col h-full bg-[#0d0d10] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl transition-opacity duration-150 relative ${
        !isFolderSelected ? 'opacity-50' : 'opacity-100'
      }`}
    >
      {/* Panel Header */}
      <div className="p-5 pb-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-xl font-medium tracking-tight text-zinc-100">
            {isDraftsFolder ? 'drafts' : 'chapters'}
          </h2>
          <span className="font-mono text-sm text-zinc-500 font-normal">
            / {chapters.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sort Dropdown */}
          <div className="relative">
            <button
              onClick={() => isFolderSelected && setIsSortOpen(!isSortOpen)}
              disabled={!isFolderSelected || chapters.length === 0}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                isFolderSelected && chapters.length > 0
                  ? 'bg-zinc-900 border-white/[0.08] text-zinc-300 hover:text-white hover:border-white/[0.18] cursor-pointer'
                  : 'bg-zinc-900/30 border-white/[0.04] text-zinc-600 cursor-not-allowed'
              }`}
              title="Sort chapters"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500" />
              <span className="hidden sm:inline">Sort</span>
              <ChevronDown className="w-3 h-3 text-zinc-600" />
            </button>

            {isSortOpen && isFolderSelected && (
              <>
                <div 
                  className="fixed inset-0 z-20" 
                  onClick={() => setIsSortOpen(false)} 
                />
                <div className="absolute right-0 mt-1.5 w-48 bg-[#18181c] border border-white/[0.12] rounded-xl shadow-2xl p-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-zinc-500">
                    Sort by
                  </div>
                  {(Object.keys(sortLabels) as SortMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setSortMode(mode);
                        setIsSortOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <span>{sortLabels[mode]}</span>
                      {sortMode === mode && <Check className="w-3 h-3 text-white" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Add Chapter Button */}
          <button
            onClick={handleOpenAdd}
            disabled={!isFolderSelected}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isFolderSelected
                ? 'bg-zinc-100 text-zinc-950 hover:bg-white hover:shadow-sm active:scale-95 cursor-pointer'
                : 'bg-zinc-900/40 text-zinc-600 border border-white/[0.04] cursor-not-allowed opacity-40'
            }`}
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Chapters List Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
        {!isFolderSelected ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/[0.06] rounded-xl">
            <FolderOpen className="w-8 h-8 text-zinc-600 mb-2 stroke-1" />
            <p className="text-sm font-medium text-zinc-400">No project selected</p>
          </div>
        ) : chapters.length === 0 ? (
          <div
            onClick={handleOpenAdd}
            className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/[0.08] hover:border-white/[0.22] rounded-xl cursor-pointer group transition-all"
            title={isDraftsFolder ? "Click to add draft" : "Click to add chapter"}
          >
            <FileText className="w-8 h-8 text-zinc-600 group-hover:text-zinc-400 mb-2 stroke-1 transition-colors" />
            <p className="text-sm font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">
              {isDraftsFolder ? 'No drafts' : 'No chapters'}
            </p>
            <p className="text-xs text-zinc-600 group-hover:text-zinc-400 mt-1 transition-colors">
              Click + Add or drag & drop images/folders here
            </p>
          </div>
        ) : (
          sortedChapters.map((chapter) => {
            const isSelected = selectedChapterId === chapter.id;
            const isTargeted = dropTargetChapterId === chapter.id;

            return (
              <div
                key={chapter.id}
                onClick={() => handleChapterClick(chapter)}
                onDragOver={(e) => {
                  e.stopPropagation();
                  setDropTargetChapterId(chapter.id);
                }}
                className={`group relative flex items-center justify-between px-5 py-3.5 rounded-2xl cursor-pointer transition-all duration-150 ${
                  isTargeted
                    ? 'bg-sky-950/60 border-2 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.3)]'
                    : isSelected
                    ? 'bg-[#181820] border-2 border-white shadow-[0_0_15px_rgba(255,255,255,0.08)]'
                    : 'bg-[#141418] border border-white/[0.08] hover:border-white/[0.22] hover:bg-[#18181e]'
                }`}
              >
                {/* Left: Chapter Name */}
                <div className="flex items-center gap-3">
                  <span className={`text-base tracking-tight transition-colors ${
                    isSelected ? 'text-white font-medium' : 'text-zinc-200 group-hover:text-white font-normal'
                  }`}>
                    {chapter.name}
                  </span>
                </div>

                {/* Right: Pages info & Action Buttons */}
                <div className="flex items-center gap-3">
                  {chapter.pages > 0 && (
                    <span className="text-xs text-zinc-500 font-mono group-hover:text-zinc-400 transition-colors">
                      pages {chapter.pages}
                    </span>
                  )}

                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddImagesToChapter(chapter);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      title="Add images"
                      aria-label={`Add images to ${chapter.name}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleOpenShowPages(chapter, e)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      title="Show pages"
                      aria-label={`Show pages for ${chapter.name}`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleOpenRename(chapter, e)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      title="Rename"
                      aria-label={`Rename ${chapter.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleOpenDelete(chapter, e)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete"
                      aria-label={`Delete ${chapter.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Visual OS Drag & Drop Overlay */}
      {isOsDragOver && (
        <div className="absolute inset-0 bg-sky-950/80 border-2 border-dashed border-sky-400 z-50 flex flex-col items-center justify-center gap-2 pointer-events-none backdrop-blur-xs">
          <UploadCloud className="w-10 h-10 text-sky-300 animate-bounce" />
          <span className="font-mono text-xs font-bold text-sky-200 uppercase tracking-wider">
            {dropTargetChapterId ? 'Drop to Ingest Into Target Chapter' : 'Drop to Ingest as New Chapter'}
          </span>
        </div>
      )}

      {/* Add Chapter / Add Draft Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title={isDraftsFolder ? "Add Draft" : "Add Chapter"}
      >
        <form onSubmit={handleCreateChapter} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
              {isDraftsFolder ? "Draft Title" : "Chapter Title"}
            </label>
            <input
              type="text"
              value={newChapterName}
              onChange={(e) => setNewChapterName(e.target.value)}
              placeholder="e.g. Chapter 1"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-white/[0.3] text-sm font-medium"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-white transition-colors"
            >
              Add
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename Chapter Modal */}
      <Modal
        isOpen={!!editingChapter}
        onClose={() => setEditingChapter(null)}
        title="Rename Chapter"
      >
        <form onSubmit={handleSaveRename} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
              New Title
            </label>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-white/[0.3] text-sm font-medium"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingChapter(null)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-white transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Show Pages Modal */}
      <Modal
        isOpen={!!viewingChapterId}
        onClose={() => setViewingChapterId(null)}
        title={viewingChapter ? `Pages in ${viewingChapter.name}` : 'Pages'}
      >
        <div className="space-y-4 max-h-[70vh] flex flex-col">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
            {displayPages.length === 0 ? (
              <div className="text-center py-12 text-zinc-500 text-sm">
                No pages in this chapter yet.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {displayPages.map((page, idx) => (
                  <div
                    key={page.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, page.id)}
                    onDragEnter={() => handleDragEnter(page.id)}
                    onDragEnd={handleDragEnd}
                    className="relative cursor-move"
                  >
                    <PageThumbnail
                      page={page}
                      onDelete={handleDeletePage}
                      onClick={() => setFullscreenPageIndex(idx)}
                      isDragging={draggedId === page.id}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-white/[0.08]">
            <span className="text-xs font-mono text-zinc-500">
              {displayPages.length} pages total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setViewingChapterId(null)}
                className="px-5 py-2 rounded-xl text-xs font-medium bg-white text-zinc-950 hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Fullscreen Page Viewer */}
      {fullscreenPageIndex !== null && displayPages.length > 0 && (
        <PageImageViewer
          pages={displayPages}
          initialIndex={fullscreenPageIndex}
          onClose={() => setFullscreenPageIndex(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingChapter}
        onClose={() => setDeletingChapter(null)}
        title={`Delete "${deletingChapter?.name}"?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setDeletingChapter(null)}
            className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
};
