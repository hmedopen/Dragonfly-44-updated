import React, { useState } from 'react';
import type { Folder } from '../types';
import { 
  Folder as FolderIcon, 
  Plus, 
  Pencil, 
  Trash2, 
  FilePlus,
  Compass
} from 'lucide-react';
import { Modal } from './Modal';

interface FolderGridProps {
  folders: Folder[];
  activeFolderId: string | null;
  hasSelectedChapter: boolean;
  onSelectFolder: (folder: Folder) => void;
  onAddFolder: (name: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  onStartDraft: () => void;
  onStartChapter: () => void;
}

export const FolderGrid: React.FC<FolderGridProps> = ({
  folders,
  activeFolderId,
  hasSelectedChapter: _hasSelectedChapter,
  onSelectFolder,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onStartDraft,
  onStartChapter: _onStartChapter,
}) => {
  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);

  // Context menu on right click
  const [contextMenu, setContextMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null);

  // Add folder submission
  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    onAddFolder(newFolderName.trim());
    setNewFolderName('');
    setIsAddOpen(false);
  };

  // Rename folder submission
  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder || !renameValue.trim()) return;
    onRenameFolder(editingFolder.id, renameValue.trim());
    setEditingFolder(null);
  };

  // Delete folder confirmation
  const handleConfirmDelete = () => {
    if (deletingFolder) {
      onDeleteFolder(deletingFolder.id);
      setDeletingFolder(null);
    }
  };

  const handleContextMenu = (folder: Folder, e: React.MouseEvent) => {
    e.preventDefault();
    if (folder.isSystem) return;
    setContextMenu({ folder, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0d] p-6 select-none relative">
      {/* Top Action Bar: start draft full-width */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onStartDraft}
          className="w-full py-4 px-6 rounded-2xl bg-white text-zinc-950 font-semibold text-base hover:bg-zinc-100 active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 shadow-lg cursor-pointer"
        >
          <FilePlus className="w-5 h-5 text-zinc-950" />
          <span className="font-semibold tracking-tight">start draft</span>
        </button>
      </div>

      {/* Grid of Folders: Square-Proportioned Layout, Clean & Compact */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-8">
          {/* "+" Add Project Item (Square Proportions) */}
          <div
            onClick={() => setIsAddOpen(true)}
            className="group flex flex-col items-center justify-center aspect-square p-3.5 rounded-2xl cursor-pointer hover:bg-white/[0.03] transition-colors"
          >
            <div className="w-12 h-12 rounded-2xl border border-dashed border-white/[0.18] bg-zinc-900/60 flex items-center justify-center mb-2 group-hover:border-white/[0.35] group-hover:bg-zinc-900 transition-all">
              <Plus className="w-5 h-5 text-zinc-400 group-hover:text-white stroke-[2]" />
            </div>

            <div className="w-full min-h-[2rem] max-h-[2.5rem] flex items-center justify-center">
              <span className="text-xs font-medium text-zinc-500 group-hover:text-zinc-200 text-center leading-snug">
                New Folder
              </span>
            </div>

            <span className="text-[10px] font-mono text-transparent mt-1 select-none">
              —
            </span>
          </div>

          {/* Folder Items: Square aspect-ratio, Centered & Tightly Spaced */}
          {folders.map((folder) => {
            const isActive = folder.id === activeFolderId;

            return (
              <div
                key={folder.id}
                onClick={() => onSelectFolder(folder)}
                onContextMenu={(e) => handleContextMenu(folder, e)}
                className={`group flex flex-col items-center justify-center aspect-square p-3.5 rounded-2xl cursor-pointer transition-all duration-150 ${
                  isActive
                    ? 'bg-white/[0.08]'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                {/* Centered Icon */}
                <div className="mb-2 flex items-center justify-center">
                  {folder.isSystem ? (
                    <Compass 
                      className={`w-12 h-12 stroke-[1.25] transition-all duration-150 ${
                        isActive
                          ? 'text-white scale-105'
                          : 'text-zinc-500 group-hover:text-zinc-300'
                      }`} 
                    />
                  ) : (
                    <FolderIcon 
                      className={`w-12 h-12 stroke-[1.25] transition-all duration-150 ${
                        isActive
                          ? 'text-white scale-105'
                          : 'text-zinc-500 group-hover:text-zinc-300'
                      }`} 
                    />
                  )}
                </div>

                {/* Title */}
                <div className="w-full min-h-[2rem] max-h-[2.5rem] flex items-center justify-center">
                  <span 
                    className={`line-clamp-2 text-xs text-center leading-snug break-words px-1.5 transition-colors ${
                      isActive 
                        ? 'text-white font-medium' 
                        : 'text-zinc-400 group-hover:text-zinc-200 font-normal'
                    }`}
                    title={folder.name}
                  >
                    {folder.name}
                  </span>
                </div>

                {/* Chapter Count */}
                <span className={`text-[10px] font-mono tracking-tight mt-1 transition-colors ${
                  isActive ? 'text-zinc-400' : 'text-zinc-600 group-hover:text-zinc-500'
                }`}>
                  {folder.chapters.length} ch
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right-Click Context Menu for Folders */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            style={{
              top: Math.min(contextMenu.y, window.innerHeight - 150),
              left: Math.min(contextMenu.x, window.innerWidth - 220),
            }}
            className="fixed z-50 w-48 bg-[#18181c] border border-white/[0.12] rounded-xl shadow-2xl p-1.5 animate-in zoom-in-95 duration-100"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-white/[0.06] mb-1 truncate">
              {contextMenu.folder.name}
            </div>

            <button
              onClick={() => {
                setEditingFolder(contextMenu.folder);
                setRenameValue(contextMenu.folder.name);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-zinc-400" />
              <span>Rename</span>
            </button>

            <button
              onClick={() => {
                setDeletingFolder(contextMenu.folder);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </>
      )}

      {/* Add Folder Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="New Folder"
      >
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. solo leveling ragnarok"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-white/[0.3] text-sm"
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
              className="px-4 py-2 rounded-lg text-xs font-medium bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename Folder Modal */}
      <Modal
        isOpen={!!editingFolder}
        onClose={() => setEditingFolder(null)}
        title="Rename Folder"
      >
        <form onSubmit={handleSaveRename} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-zinc-100 focus:outline-none focus:border-white/[0.3] text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingFolder(null)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-xs font-medium bg-white text-zinc-950 hover:bg-zinc-200 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Folder Modal */}
      <Modal
        isOpen={!!deletingFolder}
        onClose={() => setDeletingFolder(null)}
        title={`Delete "${deletingFolder?.name}"?`}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setDeletingFolder(null)}
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
