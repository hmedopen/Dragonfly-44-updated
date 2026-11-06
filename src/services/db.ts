/**
 * Dragonfly 44 - Unified Storage Layer (IndexedDB v4)
 * Database: dragonfly44_db
 * Stores:
 *   - page_blobs: Raw image binary objects (Blob / File) directly
 *   - page_bubbles: Bubble collections keyed by pageId
 *   - project_lore: Persistent cross-chapter lore ledger per projectId
 *   - chapter_intelligence: Progressive scene, character, and relationship memory
 *   - projects: Project metadata entities
 *   - chapters: Chapter metadata entities with projectId index
 *   - pages: Page metadata entities with chapterId index
 *   - chapter_snapshots: Rollback checkpoints for batch scans and reviews
 *   - migration_journal: Audit log of storage migrations
 */

import type { BubbleItem, ProjectLoreLedger, ChapterIntelligence } from '../types/workbench';
import type { Folder } from '../types';

const DB_NAME = 'dragonfly44_db';
const DB_VERSION = 4;

const STORE_PAGE_BLOBS = 'page_blobs';
const STORE_PAGE_BUBBLES = 'page_bubbles';
const STORE_PROJECT_LORE = 'project_lore';
const STORE_CHAPTER_INTELLIGENCE = 'chapter_intelligence';
const STORE_PROJECTS = 'projects';
const STORE_CHAPTERS = 'chapters';
const STORE_PAGES = 'pages';
const STORE_SNAPSHOTS = 'chapter_snapshots';
const STORE_MIGRATION_JOURNAL = 'migration_journal';

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 1. Existing stores from v3
      if (!db.objectStoreNames.contains(STORE_PAGE_BLOBS)) {
        db.createObjectStore(STORE_PAGE_BLOBS);
      }
      if (!db.objectStoreNames.contains(STORE_PAGE_BUBBLES)) {
        db.createObjectStore(STORE_PAGE_BUBBLES);
      }
      if (!db.objectStoreNames.contains(STORE_PROJECT_LORE)) {
        db.createObjectStore(STORE_PROJECT_LORE);
      }

      // 2. New v4 stores
      if (!db.objectStoreNames.contains(STORE_CHAPTER_INTELLIGENCE)) {
        db.createObjectStore(STORE_CHAPTER_INTELLIGENCE);
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHAPTERS)) {
        const chapterStore = db.createObjectStore(STORE_CHAPTERS, { keyPath: 'id' });
        chapterStore.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        const pageStore = db.createObjectStore(STORE_PAGES, { keyPath: 'id' });
        pageStore.createIndex('chapterId', 'chapterId', { unique: false });
        pageStore.createIndex('chapterAndIndex', ['chapterId', 'index'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapshotStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        snapshotStore.createIndex('chapterId', 'chapterId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MIGRATION_JOURNAL)) {
        db.createObjectStore(STORE_MIGRATION_JOURNAL, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// ==========================================
// BINARY IMAGE BLOBS
// ==========================================

export async function savePageBlob(pageId: string, blob: Blob | File): Promise<void> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_BLOBS);
    const request = store.put(blob, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPageBlob(pageId: string): Promise<Blob | null> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BLOBS, 'readonly');
    const store = tx.objectStore(STORE_PAGE_BLOBS);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePageBlob(pageId: string): Promise<void> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_BLOBS);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// PAGE BUBBLES
// ==========================================

export async function savePageBubbles(pageId: string, bubbles: BubbleItem[]): Promise<void> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BUBBLES, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_BUBBLES);
    const request = store.put(bubbles, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPageBubbles(pageId: string): Promise<BubbleItem[]> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BUBBLES, 'readonly');
    const store = tx.objectStore(STORE_PAGE_BUBBLES);
    const request = store.get(key);

    request.onsuccess = () => {
      const res = request.result;
      if (!res || !Array.isArray(res)) {
        resolve([]);
        return;
      }

      // Safe normalization & backward compatibility
      const migrated: BubbleItem[] = res.map((b: any, idx: number) => {
        const rawFlags = Array.isArray(b.reviewFlags)
          ? b.reviewFlags
          : Array.isArray(b.flags)
          ? b.flags.map((f: any) => ({
              id: f.id || `f-${Date.now()}-${idx}`,
              category: (f.type ? String(f.type).toLowerCase().replace(/\s+/g, '_') : 'ocr_error') as any,
              reasonAr: f.rationale || '',
              suggestedTextAr: f.proposedFix || '',
              status: f.status || 'pending',
            }))
          : [];

        return {
          id: b.id || `b-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
          pageId: b.pageId || pageId,
          chapterId: b.chapterId,
          index: typeof b.index === 'number' ? b.index : idx + 1,
          box_2d: Array.isArray(b.box_2d) && b.box_2d.length === 4 ? b.box_2d : [200, 200, 400, 400],
          type: b.type || 'speech_bubbles',
          typerPrefix: b.typerPrefix !== undefined ? b.typerPrefix : '"":',
          sourceLanguage: b.sourceLanguage || 'ja',
          sourceText: b.sourceText || '',
          originalSourceText: b.originalSourceText || b.sourceText || '',
          translatedText: b.translatedText || '',
          rawTranslatedText: b.rawTranslatedText || b.translatedText || '',
          reviewFlags: rawFlags,
          speakerCharacterId: b.speakerCharacterId,
          confidence: b.confidence,
          isManuallyEdited: b.isManuallyEdited || false,
          updatedAt: b.updatedAt || Date.now(),
        };
      });

      resolve(migrated);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePageBubbles(pageId: string): Promise<void> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_BUBBLES, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_BUBBLES);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// PROJECT LORE LEDGER
// ==========================================

export async function saveProjectLore(projectId: string, lore: ProjectLoreLedger): Promise<void> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT_LORE, 'readwrite');
    const store = tx.objectStore(STORE_PROJECT_LORE);
    const request = store.put(lore, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getProjectLore(projectId: string): Promise<ProjectLoreLedger | null> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT_LORE, 'readonly');
    const store = tx.objectStore(STORE_PROJECT_LORE);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteProjectLore(projectId: string): Promise<void> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT_LORE, 'readwrite');
    const store = tx.objectStore(STORE_PROJECT_LORE);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// CHAPTER INTELLIGENCE (LIFECYCLE & CONTEXT)
// ==========================================

export async function saveChapterIntelligence(
  chapterId: string,
  intelligence: ChapterIntelligence
): Promise<void> {
  const db = await getDatabase();
  const key = `chapter-intelligence:${chapterId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHAPTER_INTELLIGENCE, 'readwrite');
    const store = tx.objectStore(STORE_CHAPTER_INTELLIGENCE);
    const request = store.put(intelligence, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getChapterIntelligence(chapterId: string): Promise<ChapterIntelligence | null> {
  const db = await getDatabase();
  const key = `chapter-intelligence:${chapterId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHAPTER_INTELLIGENCE, 'readonly');
    const store = tx.objectStore(STORE_CHAPTER_INTELLIGENCE);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// CHAPTER ROLLBACK SNAPSHOTS
// ==========================================

export interface ChapterSnapshot {
  id: string;
  chapterId: string;
  timestamp: number;
  description: string;
  bubblesByPage: Record<string, BubbleItem[]>;
}

export async function createChapterSnapshot(
  chapterId: string,
  description: string,
  pages: { id: string }[]
): Promise<string> {
  const db = await getDatabase();
  const snapshotId = `snapshot-${chapterId}-${Date.now()}`;

  const bubblesByPage: Record<string, BubbleItem[]> = {};
  for (const page of pages) {
    bubblesByPage[page.id] = await getPageBubbles(page.id);
  }

  const snapshot: ChapterSnapshot = {
    id: snapshotId,
    chapterId,
    timestamp: Date.now(),
    description,
    bubblesByPage,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const request = store.put(snapshot);

    request.onsuccess = () => resolve(snapshotId);
    request.onerror = () => reject(request.error);
  });
}

export async function restoreChapterSnapshot(snapshotId: string): Promise<ChapterSnapshot | null> {
  const db = await getDatabase();

  const snapshot: ChapterSnapshot | null = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    const request = store.get(snapshotId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });

  if (!snapshot) return null;

  for (const [pageId, bubbles] of Object.entries(snapshot.bubblesByPage)) {
    await savePageBubbles(pageId, bubbles);
  }

  return snapshot;
}

// ==========================================
// IDEMPOTENT & RECOVERABLE DATABASE MIGRATION
// ==========================================

export interface MigrationJournalEntry {
  key: string;
  version: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  timestamp: number;
  migratedProjectsCount: number;
  migratedChaptersCount: number;
  migratedPagesCount: number;
  error?: string;
}

/**
 * Executes a safe, idempotent storage migration from localStorage to IndexedDB v4.
 * Can be run repeatedly without duplicating or corrupting records.
 * Retains localStorage intact as a safety backup.
 */
export async function runIdempotentStorageMigration(): Promise<MigrationJournalEntry> {
  const db = await getDatabase();

  // Check if migration has already completed
  const existingJournal: MigrationJournalEntry | null = await new Promise((resolve) => {
    const tx = db.transaction(STORE_MIGRATION_JOURNAL, 'readonly');
    const store = tx.objectStore(STORE_MIGRATION_JOURNAL);
    const req = store.get('storage_v4_migration');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  if (existingJournal && existingJournal.status === 'completed') {
    return existingJournal;
  }

  const journalEntry: MigrationJournalEntry = {
    key: 'storage_v4_migration',
    version: 4,
    status: 'in_progress',
    timestamp: Date.now(),
    migratedProjectsCount: 0,
    migratedChaptersCount: 0,
    migratedPagesCount: 0,
  };

  try {
    // Record migration start
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MIGRATION_JOURNAL, 'readwrite');
      const store = tx.objectStore(STORE_MIGRATION_JOURNAL);
      const req = store.put(journalEntry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Read folders from localStorage (v5 or v4)
    const rawFolders = localStorage.getItem('dragonfly44_folders_v5') || localStorage.getItem('dragonfly44_folders_v4');
    if (!rawFolders) {
      journalEntry.status = 'completed';
      await saveJournalEntry(db, journalEntry);
      return journalEntry;
    }

    const folders: Folder[] = JSON.parse(rawFolders);
    if (!Array.isArray(folders)) {
      journalEntry.status = 'completed';
      await saveJournalEntry(db, journalEntry);
      return journalEntry;
    }

    // Begin atomic migration transaction
    const tx = db.transaction([STORE_PROJECTS, STORE_CHAPTERS, STORE_PAGES], 'readwrite');
    const projectStore = tx.objectStore(STORE_PROJECTS);
    const chapterStore = tx.objectStore(STORE_CHAPTERS);
    const pageStore = tx.objectStore(STORE_PAGES);

    for (const folder of folders) {
      const projectRecord = {
        id: folder.id,
        name: folder.name,
        badgeCount: folder.badgeCount || (folder.chapters ? folder.chapters.length : 0),
        createdAt: folder.createdAt || Date.now(),
        isSystem: Boolean(folder.isSystem),
        isDraft: Boolean(folder.isDraft),
        updatedAt: Date.now(),
      };
      projectStore.put(projectRecord);
      journalEntry.migratedProjectsCount++;

      const chapters = Array.isArray(folder.chapters) ? folder.chapters : [];
      for (const chapter of chapters) {
        const chapterRecord = {
          id: chapter.id,
          projectId: folder.id,
          name: chapter.name,
          pages: chapter.pages || (chapter.pageList ? chapter.pageList.length : 0),
          createdAt: chapter.createdAt || Date.now(),
          status: chapter.status || 'in_progress',
          isDraft: Boolean(chapter.isDraft || folder.isDraft || folder.isSystem),
          updatedAt: Date.now(),
        };
        chapterStore.put(chapterRecord);
        journalEntry.migratedChaptersCount++;

        const pageList = Array.isArray(chapter.pageList) ? chapter.pageList : [];
        for (let idx = 0; idx < pageList.length; idx++) {
          const page = pageList[idx];
          const pageRecord = {
            id: page.id,
            chapterId: chapter.id,
            index: page.index || idx + 1,
            fileName: page.fileName || `page_${idx + 1}.png`,
            scanStatus: page.scanStatus || 'unscanned',
            createdAt: Date.now(),
          };
          pageStore.put(pageRecord);
          journalEntry.migratedPagesCount++;
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Migration transaction aborted'));
    });

    journalEntry.status = 'completed';
    await saveJournalEntry(db, journalEntry);
    console.log(`[StorageEngine] Migration completed successfully: ${journalEntry.migratedProjectsCount} projects, ${journalEntry.migratedChaptersCount} chapters, ${journalEntry.migratedPagesCount} pages.`);
    return journalEntry;
  } catch (err: any) {
    console.error('[StorageEngine] Migration failed:', err);
    journalEntry.status = 'failed';
    journalEntry.error = err?.message || String(err);
    await saveJournalEntry(db, journalEntry).catch(() => {});
    return journalEntry;
  }
}

async function saveJournalEntry(db: IDBDatabase, entry: MigrationJournalEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MIGRATION_JOURNAL, 'readwrite');
    const store = tx.objectStore(STORE_MIGRATION_JOURNAL);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
