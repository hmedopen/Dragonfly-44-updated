import type { Chapter, Folder } from '../../../types';
import type { ChapterMetadata, ChapterPage, DownloadedImageData, WorkspaceImportResult } from '../types';
import { ingestImageFiles } from '../../../services/fileIngestion';

export interface ImportToWorkspaceParams {
  selectedPages: ChapterPage[];
  imageMap: Map<string, DownloadedImageData>;
  metadata: ChapterMetadata | null;
  targetFolder: Folder | null;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  openChapter: (chapterId: string, folderId?: string | null, pageId?: string | null) => void;
  setActiveFolderId?: (folderId: string | null) => void;
  setSelectedChapterId?: (chapterId: string | null) => void;
}

export class ChapterWorkspaceImporter {
  /**
   * Imports selected chapter images into the Folio Script workspace by routing them
   * directly through the standard file ingestion pipeline (ingestImageFiles -> savePageBlob).
   */
  public static async importPagesToWorkspace(params: ImportToWorkspaceParams): Promise<WorkspaceImportResult> {
    const {
      selectedPages,
      imageMap,
      metadata,
      targetFolder,
      folders,
      setFolders,
      openChapter,
      setActiveFolderId,
      setSelectedChapterId,
    } = params;

    if (selectedPages.length === 0) {
      throw new Error('No pages selected for import.');
    }

    // 1. Sort pages by original index to strictly preserve source ordering
    const sorted = [...selectedPages].sort((a, b) => a.originalIndex - b.originalIndex);

    // 2. Convert raw image byte buffers into standard File objects for the ingestion pipeline
    const files: File[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const page = sorted[i];
      const img = imageMap.get(page.id);
      if (!img || !img.data || img.data.length === 0) {
        throw new Error(`Page ${page.originalIndex} (${page.filename}) has not completed downloading.`);
      }

      // Use sequential filename with real extension: 001.webp, 002.png, etc.
      const seqFilename = `${String(i + 1).padStart(3, '0')}.${img.extension}`;
      const file = new File([img.data as any], seqFilename, {
        type: img.mimeType,
        lastModified: Date.now(),
      });
      files.push(file);
    }

    // 3. Pass images through existing ingestImageFiles (persists to IndexedDB page_blobs & computes dimensions)
    const ingestionResult = await ingestImageFiles(files, 1);

    if (ingestionResult.count === 0) {
      throw new Error('Image ingestion yielded 0 pages.');
    }

    // 4. Resolve destination folder (active project or drafts folder)
    let folderId = targetFolder?.id;
    if (!folderId) {
      const draftsFolder = folders.find((f) => f.id === 'folder-drafts') || folders[0];
      folderId = draftsFolder?.id || 'folder-drafts';
    }

    const resolvedFolder = folders.find((f) => f.id === folderId) || targetFolder || folders[0];
    const isDraft = Boolean(resolvedFolder?.isSystem || resolvedFolder?.isDraft || folderId === 'folder-drafts');

    // 5. Construct Chapter Name from metadata
    let chapterName = 'Imported Chapter';
    if (metadata) {
      const numPart = metadata.chapterNumber ? `Chapter ${metadata.chapterNumber}` : '';
      const titlePart = metadata.chapterTitle ? metadata.chapterTitle : '';
      if (numPart && titlePart) {
        chapterName = `${numPart} — ${titlePart}`;
      } else if (numPart) {
        chapterName = numPart;
      } else if (titlePart) {
        chapterName = titlePart;
      } else if (metadata.seriesTitle) {
        chapterName = `${metadata.seriesTitle} Chapter`;
      }
    }

    const chapterId = `${isDraft ? 'dr' : 'chapter'}-${Date.now()}`;

    // 6. Construct standard Folio Script Chapter entity
    const newChapter: Chapter = {
      id: chapterId,
      name: chapterName,
      pages: ingestionResult.count,
      createdAt: Date.now(),
      pageList: ingestionResult.pages,
      isDraft,
      status: 'in_progress',
    };

    // 7. Update workspace state & trigger persistence
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) {
          const updatedChapters = [newChapter, ...(f.chapters || [])];
          return {
            ...f,
            chapters: updatedChapters,
            badgeCount: updatedChapters.length,
          };
        }
        return f;
      })
    );

    if (setActiveFolderId) {
      setActiveFolderId(folderId);
    }
    if (setSelectedChapterId) {
      setSelectedChapterId(newChapter.id);
    }

    // 8. Open and navigate directly to the newly imported chapter
    const firstPageId = newChapter.pageList?.[0]?.id || null;
    openChapter(newChapter.id, folderId, firstPageId);

    return {
      success: true,
      chapterId: newChapter.id,
      chapterName: newChapter.name,
      folderId,
      pageCount: newChapter.pages,
    };
  }
}
