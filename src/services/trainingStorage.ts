/**
 * Dragonfly 44 - Training Studio Storage Service
 * Handles persistence for Reference Sets and image Blobs in IndexedDB.
 * Completely empty initial state by default.
 */

import { getDatabase, STORE_TRAINING_REFERENCE_SETS, STORE_TRAINING_BLOBS } from './db';
import type { TrainingReferenceSet, ReferenceExample } from '../types/training';

export class TrainingStorageService {
  /**
   * Retrieves all reference sets, sorted by priority (descending) then title.
   * Returns empty array if none exist.
   */
  async getAllReferenceSets(): Promise<TrainingReferenceSet[]> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_REFERENCE_SETS, 'readonly');
      const store = tx.objectStore(STORE_TRAINING_REFERENCE_SETS);
      const request = store.getAll();

      request.onsuccess = () => {
        const sets: TrainingReferenceSet[] = request.result || [];
        sets.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
        resolve(sets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieves a single reference set by ID.
   */
  async getReferenceSetById(id: string): Promise<TrainingReferenceSet | null> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_REFERENCE_SETS, 'readonly');
      const store = tx.objectStore(STORE_TRAINING_REFERENCE_SETS);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Saves or updates a reference set.
   * Automatically updates timestamps and increments version if modified.
   */
  async saveReferenceSet(set: TrainingReferenceSet): Promise<TrainingReferenceSet> {
    const db = await getDatabase();
    const now = Date.now();

    // Ensure examples maintain consistent orderIndex (1-based)
    const normalizedExamples: ReferenceExample[] = (set.examples || []).map((ex, idx) => ({
      ...ex,
      orderIndex: idx + 1,
      updatedAt: ex.updatedAt || now,
      createdAt: ex.createdAt || now,
    }));

    const updatedSet: TrainingReferenceSet = {
      ...set,
      version: (set.version || 0) + 1,
      examples: normalizedExamples,
      updatedAt: now,
      createdAt: set.createdAt || now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_REFERENCE_SETS, 'readwrite');
      const store = tx.objectStore(STORE_TRAINING_REFERENCE_SETS);
      const request = store.put(updatedSet);

      request.onsuccess = () => resolve(updatedSet);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Duplicates an existing reference set with a new ID, title, and cloned examples.
   */
  async duplicateReferenceSet(sourceId: string): Promise<TrainingReferenceSet> {
    const source = await this.getReferenceSetById(sourceId);
    if (!source) {
      throw new Error(`Reference Set not found: ${sourceId}`);
    }

    const now = Date.now();
    const newId = `ref_set_${now}_${Math.random().toString(36).substring(2, 7)}`;
    
    // Duplicate examples with new IDs but pointing to the same image blobs
    const clonedExamples: ReferenceExample[] = source.examples.map((ex, idx) => ({
      ...ex,
      id: `ex_${now}_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
      orderIndex: idx + 1,
      createdAt: now,
      updatedAt: now,
    }));

    const duplicated: TrainingReferenceSet = {
      ...source,
      id: newId,
      title: `${source.title} (Copy)`,
      version: 1,
      enabled: false, // Start duplicate as disabled for safety
      createdAt: now,
      updatedAt: now,
      examples: clonedExamples,
    };

    return this.saveReferenceSet(duplicated);
  }

  /**
   * Deletes a reference set and cleans up its associated blobs if unreferenced.
   */
  async deleteReferenceSet(id: string): Promise<void> {
    const set = await this.getReferenceSetById(id);
    const db = await getDatabase();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_REFERENCE_SETS, 'readwrite');
      const store = tx.objectStore(STORE_TRAINING_REFERENCE_SETS);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // If set had examples, clean up any orphaned blobs
    if (set && set.examples.length > 0) {
      await this.cleanupOrphanedBlobs();
    }
  }

  /**
   * Saves a binary image Blob into the training_blobs store.
   */
  async saveTrainingBlob(key: string, blob: Blob | File): Promise<void> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_TRAINING_BLOBS);
      const request = store.put(blob, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieves an image Blob from the training_blobs store.
   */
  async getTrainingBlob(key: string): Promise<Blob | null> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_BLOBS, 'readonly');
      const store = tx.objectStore(STORE_TRAINING_BLOBS);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Deletes a training image Blob.
   */
  async deleteTrainingBlob(key: string): Promise<void> {
    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_TRAINING_BLOBS);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Scans all reference sets and purges blobs in training_blobs that are no longer referenced.
   */
  async cleanupOrphanedBlobs(): Promise<number> {
    const allSets = await this.getAllReferenceSets();
    const activeKeys = new Set<string>();
    for (const set of allSets) {
      for (const ex of set.examples) {
        if (ex.blobKey) activeKeys.add(ex.blobKey);
      }
    }

    const db = await getDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRAINING_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_TRAINING_BLOBS);
      const request = store.getAllKeys();

      request.onsuccess = async () => {
        const keys = (request.result as string[]) || [];
        let deletedCount = 0;
        for (const k of keys) {
          if (!activeKeys.has(k)) {
            store.delete(k);
            deletedCount++;
          }
        }
        resolve(deletedCount);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const trainingStorage = new TrainingStorageService();
