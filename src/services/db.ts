/**
 * IndexedDB storage layer for Dragonfly 44
 * Database: dragonfly44_db
 * Stores: page_blobs, page_bubbles, project_lore
 */

import type { BubbleItem, ProjectLoreLedger } from '../types/workbench';

const DB_NAME = 'dragonfly44_db';
const DB_VERSION = 3;
const STORE_NAME = 'page_blobs';
const BUBBLES_STORE_NAME = 'page_bubbles';
const PROJECT_LORE_STORE_NAME = 'project_lore';

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(BUBBLES_STORE_NAME)) {
        db.createObjectStore(BUBBLES_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(PROJECT_LORE_STORE_NAME)) {
        db.createObjectStore(PROJECT_LORE_STORE_NAME);
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

/**
 * Save an image binary: store incoming raw Blob or File objects directly under `page-blob:${pageId}`.
 * Zero base64 strings in React/Zustand memory.
 */
export async function savePageBlob(pageId: string, blob: Blob | File): Promise<void> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(blob, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve an image binary: return the stored Blob for a given pageId.
 */
export async function getPageBlob(pageId: string): Promise<Blob | null> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete an image binary by pageId
 */
export async function deletePageBlob(pageId: string): Promise<void> {
  const db = await getDatabase();
  const key = `page-blob:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save bubbles for a given pageId
 */
export async function savePageBubbles(pageId: string, bubbles: BubbleItem[]): Promise<void> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BUBBLES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BUBBLES_STORE_NAME);
    const request = store.put(bubbles, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve bubbles for a given pageId
 */
export async function getPageBubbles(pageId: string): Promise<BubbleItem[]> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BUBBLES_STORE_NAME, 'readonly');
    const store = tx.objectStore(BUBBLES_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const res = request.result;
      if (!res || !Array.isArray(res)) {
        resolve([]);
        return;
      }
      // Migrate any legacy flags format to reviewFlags safely
      const migrated: BubbleItem[] = res.map((b: any) => ({
        id: b.id || `b-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        pageId: b.pageId || pageId,
        index: b.index || 1,
        box_2d: b.box_2d || [200, 200, 400, 400],
        type: b.type || 'dialogue',
        typerPrefix: b.typerPrefix ?? '():',
        sourceLanguage: b.sourceLanguage || 'ja',
        sourceText: b.sourceText || '',
        originalSourceText: b.originalSourceText || b.sourceText || '',
        translatedText: b.translatedText || '',
        rawTranslatedText: b.rawTranslatedText || b.translatedText || '',
        reviewFlags: Array.isArray(b.reviewFlags)
          ? b.reviewFlags
          : Array.isArray(b.flags)
          ? b.flags.map((f: any) => ({
              id: f.id || `f-${Date.now()}`,
              category: (f.type ? String(f.type).toLowerCase().replace(/\s+/g, '_') : 'ocr_error') as any,
              reasonAr: f.rationale || '',
              suggestedTextAr: f.proposedFix || '',
              status: f.status || 'pending',
            }))
          : [],
      }));
      resolve(migrated);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete bubbles for a given pageId
 */
export async function deletePageBubbles(pageId: string): Promise<void> {
  const db = await getDatabase();
  const key = `page-bubbles:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BUBBLES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BUBBLES_STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save Project Lore Ledger (for cross-chapter character & term consistency)
 */
export async function saveProjectLore(projectId: string, lore: ProjectLoreLedger): Promise<void> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_LORE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_LORE_STORE_NAME);
    const request = store.put(lore, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve Project Lore Ledger for a projectId
 */
export async function getProjectLore(projectId: string): Promise<ProjectLoreLedger | null> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_LORE_STORE_NAME, 'readonly');
    const store = tx.objectStore(PROJECT_LORE_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete Project Lore Ledger by projectId
 */
export async function deleteProjectLore(projectId: string): Promise<void> {
  const db = await getDatabase();
  const key = `project-lore:${projectId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROJECT_LORE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_LORE_STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
