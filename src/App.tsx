import { useState, useEffect } from 'react';
import { ChapterList } from './components/ChapterList';
import { FolderGrid } from './components/FolderGrid';
import { Workbench } from './components/Workbench/Workbench';
import { TitleBar } from './components/TitleBar';
import { useWorkbenchStore } from './store/workbenchStore';
import { initialFolders } from './mockData';
import type { Folder, Chapter, PageMetadata } from './types';
import { Sparkles } from 'lucide-react';
import { pickImageFiles, ingestImageFiles, formatDraftName } from './services/fileIngestion';
import { deletePageBlob, runIdempotentStorageMigration } from './services/db';

export function App() {
  const {
    currentView,
    activeChapterId,
    openChapter,
    returnToHub,
  } = useWorkbenchStore();

  const [folders, setFolders] = useState<Folder[]>(() => {
    const defaultProjectIds = new Set([
      'folder-1',
      'folder-2',
      'folder-3',
      'folder-4',
      'folder-5',
      'folder-6',
    ]);
    const mockChapterIds = new Set(['dr-1', 'dr-2']);

    const cleanFolder = (f: Folder): Folder => {
      const cleanChapters = (f.chapters || []).filter((c) => !mockChapterIds.has(c.id));
      return {
        ...f,
        chapters: cleanChapters,
        badgeCount: cleanChapters.length,
      };
    };

    const saved = localStorage.getItem('dragonfly44_folders_v5');
    if (saved) {
      try {
        const parsed: Folder[] = JSON.parse(saved);
        const filtered = parsed
          .filter((f) => !defaultProjectIds.has(f.id))
          .map(cleanFolder);
        const hasDrafts = filtered.some((f) => f.id === 'folder-drafts');
        if (hasDrafts && filtered.length > 0) return filtered;
      } catch (e) {
        console.error('Failed to parse saved folders v5', e);
      }
    }

    const savedV4 = localStorage.getItem('dragonfly44_folders_v4');
    if (savedV4) {
      try {
        const parsed: Folder[] = JSON.parse(savedV4);
        const filtered = parsed
          .filter((f) => !defaultProjectIds.has(f.id))
          .map(cleanFolder);
        const hasDrafts = filtered.some((f) => f.id === 'folder-drafts');
        if (hasDrafts && filtered.length > 0) return filtered;
      } catch (e) {
        console.error('Failed to parse saved folders v4', e);
      }
    }

    return initialFolders;
  });

  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Persist folders
  useEffect(() => {
    localStorage.setItem('dragonfly44_folders_v5', JSON.stringify(folders));
  }, [folders]);

  // Idempotent database & storage migration on mount
  useEffect(() => {
    runIdempotentStorageMigration().catch((err) => {
      console.warn('[StorageEngine] Migration warning:', err);
    });
  }, []);

  // Context-menu guard: block default browser context menu on non-input chrome
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return; // Allow context menu in text fields
      }
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const activeFolder = folders.find((f) => f.id === activeFolderId) || null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleSelectFolder = (folder: Folder) => {
    if (activeFolderId === folder.id) {
      setActiveFolderId(null);
    } else {
      setActiveFolderId(folder.id);
    }
    setSelectedChapterId(null);
  };

  const handleAddFolder = (name: string) => {
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name,
      badgeCount: 0,
      createdAt: Date.now(),
      chapters: [],
      isDraft: false,
    };

    const draftsFolder = folders.find((f) => f.id === 'folder-drafts') || initialFolders[0];
    const rest = folders.filter((f) => f.id !== 'folder-drafts');

    const updated = [draftsFolder, newFolder, ...rest];
    setFolders(updated);
    setActiveFolderId(newFolder.id);
    setSelectedChapterId(null);
    showToast(`Created folder "${name}"`);
  };

  const handleRenameFolder = (id: string, newName: string) => {
    if (id === 'folder-drafts') return;
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: newName } : f))
    );
    showToast(`Renamed to "${newName}"`);
  };

  const handleDeleteFolder = (id: string) => {
    if (id === 'folder-drafts') {
      showToast('The drafts folder is permanent');
      return;
    }
    const updated = folders.filter((f) => f.id !== id);
    setFolders(updated);

    if (activeFolderId === id) {
      const remainingProjects = updated.filter((f) => !f.isSystem && !f.isDraft);
      setActiveFolderId(remainingProjects[0]?.id || null);
      setSelectedChapterId(null);
    }
    showToast('Folder deleted');
  };

  const handleAddChapter = (name: string) => {
    if (!activeFolder) return;
    const isDraft = activeFolder.isSystem || activeFolder.isDraft;
    const newChapter: Chapter = {
      id: `${isDraft ? 'dr' : 'chapter'}-${Date.now()}`,
      name,
      pages: 0,
      createdAt: Date.now(),
      pageList: [],
      isDraft,
    };
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === activeFolder.id) {
          const updatedChapters = [newChapter, ...f.chapters];
          return {
            ...f,
            chapters: updatedChapters,
            badgeCount: updatedChapters.length,
          };
        }
        return f;
      })
    );
    setSelectedChapterId(newChapter.id);
    showToast(`Created "${name}"`);
  };

  const handleAddChapterWithFiles = async (name: string, files: File[]) => {
    if (!activeFolder) return;
    try {
      const result = await ingestImageFiles(files);
      const isDraft = activeFolder.isSystem || activeFolder.isDraft;
      const newChapter: Chapter = {
        id: `${isDraft ? 'dr' : 'chapter'}-${Date.now()}`,
        name,
        pages: result.count,
        createdAt: Date.now(),
        pageList: result.pages,
        isDraft,
      };
      setFolders((prev) =>
        prev.map((f) => {
          if (f.id === activeFolder.id) {
            const updatedChapters = [newChapter, ...f.chapters];
            return {
              ...f,
              chapters: updatedChapters,
              badgeCount: updatedChapters.length,
            };
          }
          return f;
        })
      );
      setSelectedChapterId(newChapter.id);
      showToast(`Created "${name}" with ${result.count} pages`);
    } catch (err) {
      console.error('Error adding chapter with files', err);
      showToast('Error ingesting files');
    }
  };

  const handleAddImagesToChapter = async (chapter: Chapter, filesInput?: File[]) => {
    if (!activeFolder) return;

    try {
      const files = filesInput && filesInput.length > 0 ? filesInput : await pickImageFiles();
      if (files.length === 0) return;

      const result = await ingestImageFiles(files);

      const existingPages = chapter.pageList || [];
      const offset = existingPages.length;
      const adjustedNewPages = result.pages.map((p, idx) => ({
        ...p,
        index: offset + idx + 1,
      }));
      const combinedPageList = [...existingPages, ...adjustedNewPages];

      setFolders((prev) =>
        prev.map((f) => {
          if (f.id === activeFolder.id) {
            return {
              ...f,
              chapters: f.chapters.map((c) =>
                c.id === chapter.id
                  ? {
                      ...c,
                      pages: combinedPageList.length,
                      pageList: combinedPageList,
                    }
                  : c
              ),
            };
          }
          return f;
        })
      );

      showToast(`Added ${result.count} images to "${chapter.name}" (${combinedPageList.length} pages total)`);
    } catch (err) {
      console.error('Error adding images to chapter', err);
      showToast('Error adding images');
    }
  };

  const handleRenameChapter = (chapterId: string, newName: string) => {
    if (!activeFolder) return;
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            chapters: f.chapters.map((c) =>
              c.id === chapterId ? { ...c, name: newName } : c
            ),
          };
        }
        return f;
      })
    );
    showToast(`Updated "${newName}"`);
  };

  const handleDeleteChapter = (chapterId: string) => {
    if (!activeFolder) return;
    const chapter = activeFolder.chapters.find((c) => c.id === chapterId);
    if (chapter?.pageList) {
      chapter.pageList.forEach((page) => {
        deletePageBlob(page.id).catch((e) => console.error(e));
      });
    }
    if (selectedChapterId === chapterId) {
      setSelectedChapterId(null);
    }
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === activeFolder.id) {
          const updated = f.chapters.filter((c) => c.id !== chapterId);
          return {
            ...f,
            chapters: updated,
            badgeCount: updated.length,
          };
        }
        return f;
      })
    );
    showToast('Chapter removed');
  };

  const handleDeletePageFromChapter = (chapterId: string, pageId: string) => {
    if (!activeFolder) return;

    deletePageBlob(pageId).catch((err) => console.error('Failed to delete blob from db', err));

    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            chapters: f.chapters.map((c) => {
              if (c.id === chapterId) {
                const remaining = (c.pageList || []).filter((p) => p.id !== pageId);
                const reindexed = remaining.map((p, idx) => ({
                  ...p,
                  index: idx + 1,
                }));
                return {
                  ...c,
                  pages: reindexed.length,
                  pageList: reindexed,
                };
              }
              return c;
            }),
          };
        }
        return f;
      })
    );
    showToast('Page deleted');
  };

  const handleReorderPages = (chapterId: string, updatedPageList: PageMetadata[]) => {
    if (!activeFolder) return;

    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === activeFolder.id) {
          return {
            ...f,
            chapters: f.chapters.map((c) =>
              c.id === chapterId
                ? {
                    ...c,
                    pageList: updatedPageList,
                    pages: updatedPageList.length,
                  }
                : c
            ),
          };
        }
        return f;
      })
    );
  };

  const handleStartDraft = async () => {
    try {
      const files = await pickImageFiles();
      if (files.length === 0) return;

      const result = await ingestImageFiles(files);
      const draftName = formatDraftName();

      const newDraft: Chapter = {
        id: `dr-${Date.now()}`,
        name: draftName,
        pages: result.count,
        createdAt: Date.now(),
        pageList: result.pages,
        isDraft: true,
      };

      setFolders((prev) =>
        prev.map((f) => {
          if (f.id === 'folder-drafts') {
            const updatedChapters = [newDraft, ...f.chapters];
            return {
              ...f,
              chapters: updatedChapters,
              badgeCount: updatedChapters.length,
            };
          }
          return f;
        })
      );

      setActiveFolderId('folder-drafts');
      setSelectedChapterId(newDraft.id);
      showToast(`Draft created: "${draftName}" (${result.count} pages)`);

      openChapter(newDraft.id, 'folder-drafts', newDraft.pageList?.[0]?.id || null);
    } catch (err) {
      console.error('Error starting draft', err);
      showToast('Error creating draft');
    }
  };

  const handleStartChapter = () => {
    if (!selectedChapterId || !activeFolder) return;
    const chapter = activeFolder.chapters.find((c) => c.id === selectedChapterId);
    if (!chapter) return;

    showToast(`Launching ${chapter.name}`);
    openChapter(chapter.id, activeFolder.id, chapter.pageList?.[0]?.id || null);
  };

  const handleShowPages = (chapter: Chapter) => {
    showToast(`Viewing pages for ${chapter.name}`);
  };

  // Screen transition
  const effectiveChapterId = activeChapterId || selectedChapterId;
  const activeChapter = folders
    .flatMap((f) => f.chapters)
    .find((c) => c.id === effectiveChapterId) || null;
  const activeChapterFolder = folders.find((f) =>
    f.chapters.some((c) => c.id === effectiveChapterId)
  ) || activeFolder;

  if (currentView === 'workbench') {
    return (
      <Workbench
        folder={activeChapterFolder}
        chapter={activeChapter}
        onBack={returnToHub}
        onDeletePage={(pageId) => {
          if (effectiveChapterId) {
            handleDeletePageFromChapter(effectiveChapterId, pageId);
          }
        }}
        onAppendPages={(newPages) => {
          if (!activeChapterFolder || !effectiveChapterId) return;
          setFolders((prev) =>
            prev.map((f) => {
              if (f.id === activeChapterFolder.id) {
                return {
                  ...f,
                  chapters: f.chapters.map((c) => {
                    if (c.id === effectiveChapterId) {
                      const combined = [...(c.pageList || []), ...newPages];
                      return { ...c, pages: combined.length, pageList: combined };
                    }
                    return c;
                  }),
                };
              }
              return f;
            })
          );
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans select-none">
      {/* Desktop Frameless Window Titlebar */}
      <TitleBar activeFolderName={activeFolder ? activeFolder.name : 'No project selected'} />

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* Active Project Title */}
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className={`text-2xl font-medium tracking-tight capitalize ${
            activeFolder ? 'text-white' : 'text-zinc-600'
          }`}>
            {activeFolder ? activeFolder.name : 'No project selected'}
          </h1>
        </div>

        {/* 2-Column Split: Chapters Hub on Left, Folder Organization on Right */}
        <div className="flex-1 grid grid-cols-12 gap-6 min-h-0">
          {/* Left Column: Chapters */}
          <div className="col-span-12 md:col-span-5 lg:col-span-4 h-full min-h-0">
            <ChapterList
              activeFolder={activeFolder}
              selectedChapterId={activeChapterId || selectedChapterId}
              onSelectChapter={(id) => setSelectedChapterId(id)}
              onOpenChapter={(chapter) => {
                setSelectedChapterId(chapter.id);
                showToast(`Opening ${chapter.name}`);
              }}
              onAddChapter={handleAddChapter}
              onAddChapterWithFiles={handleAddChapterWithFiles}
              onAddImagesToChapter={handleAddImagesToChapter}
              onRenameChapter={handleRenameChapter}
              onDeleteChapter={handleDeleteChapter}
              onDeletePageFromChapter={handleDeletePageFromChapter}
              onReorderPages={handleReorderPages}
              onShowPages={handleShowPages}
            />
          </div>

          {/* Right Column: Start Chapter / Draft Buttons & Square Folder Grid */}
          <div className="col-span-12 md:col-span-7 lg:col-span-8 h-full min-h-0 border border-white/[0.08] rounded-2xl overflow-hidden bg-[#0a0a0d]">
            <FolderGrid
              folders={folders}
              activeFolderId={activeFolderId}
              hasSelectedChapter={!!selectedChapterId}
              onSelectFolder={handleSelectFolder}
              onAddFolder={handleAddFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
              onStartDraft={handleStartDraft}
              onStartChapter={handleStartChapter}
            />
          </div>
        </div>
      </div>

      {/* Subtle Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-zinc-900/95 border border-white/[0.16] shadow-2xl text-xs font-medium text-white backdrop-blur-md animate-in slide-in-from-bottom-2 duration-150">
          <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
