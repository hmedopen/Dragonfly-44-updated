import { useState, useEffect, useCallback } from 'react';
import { ChapterList } from './components/ChapterList';
import { FolderGrid } from './components/FolderGrid';
import { Workbench } from './components/Workbench/Workbench';

import { SettingsModal } from './components/Settings/SettingsModal';
import { BenchmarkScreen } from './components/Benchmark/BenchmarkScreen';
import { TrainingStudioModal } from './components/Training/TrainingStudioModal';
import { isTrainingStudioEnabled } from './lib/training/env';
import { useWorkbenchStore } from './store/workbenchStore';
import { initialFolders } from './mockData';
import type { Folder, Chapter, PageMetadata } from './types';
import { Sparkles, Activity, Sliders, Stethoscope, Download } from 'lucide-react';
import { pickImageFiles, ingestImageFiles, formatDraftName } from './services/fileIngestion';
import { deletePageBlob, runIdempotentStorageMigration } from './services/db';
import { isSystemDiagnosticsEnabled } from './lib/diagnosticTap';
import { ChapterSnatchModal } from './features/chapter-snatch/components/ChapterSnatchModal';

type DevDiagnosticStudioComponent = React.ComponentType<{
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
}>;

const devDiagnosticsLoaders = import.meta.glob<{ default: DevDiagnosticStudioComponent }>(
  './dev/system-diagnostics/ui/DiagnosticStudioHost.tsx'
);
const hasDiagnosticStudioModule = Object.keys(devDiagnosticsLoaders).length > 0;

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
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState(false);
  const [isTrainingStudioOpen, setIsTrainingStudioOpen] = useState(false);
  const [isChapterSnatchOpen, setIsChapterSnatchOpen] = useState(false);
  const diagnosticsEnabled = isSystemDiagnosticsEnabled() && hasDiagnosticStudioModule;
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [DevDiagnosticsHost, setDevDiagnosticsHost] = useState<DevDiagnosticStudioComponent | null>(null);

  const loadDiagnosticsHost = useCallback(() => {
    if (!diagnosticsEnabled) return Promise.resolve(null);
    const loader = Object.values(devDiagnosticsLoaders)[0];
    if (!loader) return Promise.resolve(null);
    return loader()
      .then((mod) => {
        if (mod?.default) {
          setDevDiagnosticsHost(() => mod.default);
          return mod.default;
        }
        return null;
      })
      .catch((err) => {
        console.warn('[Diagnostics] Failed to load Diagnostic Studio module:', err);
        return null;
      });
  }, [diagnosticsEnabled]);

  useEffect(() => {
    if (!diagnosticsEnabled) return;
    void loadDiagnosticsHost();
  }, [diagnosticsEnabled, loadDiagnosticsHost]);

  const handleToggleDiagnostics = useCallback(() => {
    if (!diagnosticsEnabled) return;
    if (!DevDiagnosticsHost) {
      void loadDiagnosticsHost();
    }
    setIsDiagnosticsOpen((prev) => !prev);
  }, [diagnosticsEnabled, DevDiagnosticsHost, loadDiagnosticsHost]);

  // Global Ctrl+, shortcut for Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setIsGlobalSettingsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

      const existingPages = chapter.pageList || [];
      const offset = existingPages.length;
      const result = await ingestImageFiles(files, offset + 1);

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
    const targetFolder = folders.find((f) => f.chapters.some((c) => c.id === chapterId)) || activeFolder;
    if (!targetFolder) return;

    deletePageBlob(pageId).catch((err) => console.error('Failed to delete blob from db', err));

    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === targetFolder.id) {
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

  return (
    <>
      {currentView === 'workbench' ? (
        <Workbench
          folder={activeChapterFolder}
          chapter={activeChapter}
          onBack={returnToHub}
          onToggleDiagnostics={diagnosticsEnabled ? handleToggleDiagnostics : undefined}
          isDiagnosticsOpen={isDiagnosticsOpen}
          onDeletePage={(pageId) => {
            if (effectiveChapterId) {
              handleDeletePageFromChapter(effectiveChapterId, pageId);
            }
          }}
          onReorderPages={(updatedPages) => {
            if (effectiveChapterId) {
              handleReorderPages(effectiveChapterId, updatedPages);
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
                        const existingPages = c.pageList || [];
                        const offset = existingPages.length;
                        const adjustedNewPages = newPages.map((p, idx) => ({
                          ...p,
                          index: offset + idx + 1,
                        }));
                        const combined = [...existingPages, ...adjustedNewPages];
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
      ) : (
        <div className="flex flex-col h-screen w-screen bg-black text-zinc-100 overflow-hidden font-sans select-none">
          {/* Main Workspace */}
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            {/* Active Project Title & Workspace Action Toolbar */}
            <div className="mb-4 flex items-center justify-between shrink-0">
              <h1 className={`text-2xl font-medium tracking-tight capitalize ${
                activeFolder ? "text-white" : "text-zinc-600"
              }`}>
                {activeFolder ? activeFolder.name : "No project selected"}
              </h1>

              <div className="flex items-center gap-2">
                {diagnosticsEnabled && (
                  <button
                    type="button"
                    onClick={handleToggleDiagnostics}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-mono text-xs font-semibold transition-all cursor-pointer ${
                      isDiagnosticsOpen
                        ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                        : 'bg-zinc-900/80 hover:bg-zinc-800 border-white/[0.08] text-zinc-300 hover:text-white'
                    }`}
                    title="Open Diagnostic Studio (Dev Only, Ctrl+Shift+D)"
                  >
                    <Stethoscope className="w-3.5 h-3.5 text-sky-400" />
                    <span>Diagnostic Studio</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-300 font-bold border border-sky-500/30">DEV</span>
                  </button>
                )}

                {isTrainingStudioEnabled() && (
                  <button
                    type="button"
                    onClick={() => setIsTrainingStudioOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-mono text-xs font-semibold shadow-lg shadow-amber-950/20 transition-all cursor-pointer"
                    title="Open Training Studio (Dev Only)"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                    <span>Training Studio</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">DEV</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsBenchmarkOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-white/[0.08] transition-colors cursor-pointer"
                  title="Quality Benchmark Engine"
                >
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>Benchmark</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsChapterSnatchOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800 border border-white/[0.08] transition-colors cursor-pointer"
                  title="Fetch manga or webtoon chapters"
                >
                  <Download className="w-3.5 h-3.5 text-zinc-300" />
                  <span>Fetch Chapter</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsGlobalSettingsOpen(true)}
                  className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/80 border border-white/[0.08] transition-colors cursor-pointer"
                  title="Settings (Ctrl+,)"
                >
                  <Sliders className="w-4 h-4" />
                </button>
              </div>
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

          {/* System #6 Settings Modal */}
          <SettingsModal
            isOpen={isGlobalSettingsOpen}
            onClose={() => setIsGlobalSettingsOpen(false)}
            onOpenBenchmark={() => setIsBenchmarkOpen(true)}
            projectId={activeFolder?.id}
          />

          {/* System #6 Quality Benchmark Screen */}
          <BenchmarkScreen
            isOpen={isBenchmarkOpen}
            onClose={() => setIsBenchmarkOpen(false)}
          />

          {/* Training Studio Modal (Dev Only) */}
          <TrainingStudioModal
            isOpen={isTrainingStudioOpen}
            onClose={() => setIsTrainingStudioOpen(false)}
          />

          {/* Chapter Snatch Modal */}
          <ChapterSnatchModal
            isOpen={isChapterSnatchOpen}
            onClose={() => setIsChapterSnatchOpen(false)}
            activeFolder={activeFolder}
            folders={folders}
            setFolders={setFolders}
            openChapter={openChapter}
            showToast={showToast}
            setActiveFolderId={setActiveFolderId}
            setSelectedChapterId={setSelectedChapterId}
          />
        </div>
      )}

      {diagnosticsEnabled && DevDiagnosticsHost && (
        <DevDiagnosticsHost
          isOpen={isDiagnosticsOpen}
          onClose={() => setIsDiagnosticsOpen(false)}
          onToggle={handleToggleDiagnostics}
        />
      )}
    </>
  );
}

export default App;
