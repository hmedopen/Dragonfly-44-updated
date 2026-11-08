/**
 * Folio Script - Unified Storage Layer (IndexedDB v4)
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

import type {
  BubbleItem,
  ProjectLoreLedger,
  ChapterIntelligence,
  ReviewFlagItem,
  ReviewFlagCategory,
  ReviewFlagSeverity,
} from '../types/workbench';
import type { PageScanResult } from '../types/scanning';
import type { Folder } from '../types';
import type {
  ReviewFinding,
  ReviewSnapshot,
  ReviewAuditRecord,
  FindingStatus,
  ReviewSeverity,
  ReviewDomain,
} from '../types/review';

const DB_NAME = 'dragonfly44_db';
export const DB_VERSION = 8;

const STORE_PAGE_BLOBS = 'page_blobs';
const STORE_PAGE_BUBBLES = 'page_bubbles';
const STORE_PAGE_SCANS = 'page_scans';
const STORE_PROJECT_LORE = 'project_lore';
const STORE_CHAPTER_INTELLIGENCE = 'chapter_intelligence';
const STORE_PROJECTS = 'projects';
const STORE_CHAPTERS = 'chapters';
const STORE_PAGES = 'pages';
const STORE_SNAPSHOTS = 'chapter_snapshots';
const STORE_MIGRATION_JOURNAL = 'migration_journal';
const STORE_REVIEW_FINDINGS = 'review_findings';
const STORE_REVIEW_SNAPSHOTS = 'review_snapshots';
const STORE_REVIEW_AUDIT = 'review_audit';
const STORE_KNOWLEDGE_RECORDS = 'knowledge_records';
const STORE_KNOWLEDGE_REVISIONS = 'knowledge_revisions';
const STORE_KNOWLEDGE_CANDIDATES = 'knowledge_candidates';
const STORE_KNOWLEDGE_AUDIT = 'knowledge_audit';
const STORE_KNOWLEDGE_QUARANTINE = 'knowledge_quarantine';
const STORE_KNOWLEDGE_CONFLICTS = 'knowledge_conflicts';
const STORE_KNOWLEDGE_IDEMPOTENCY = 'knowledge_idempotency';
const STORE_MEMORY_SETTINGS = 'memory_settings';
export const STORE_TRAINING_REFERENCE_SETS = 'training_reference_sets';
export const STORE_TRAINING_BLOBS = 'training_blobs';

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
      if (!db.objectStoreNames.contains(STORE_PAGE_SCANS)) {
        db.createObjectStore(STORE_PAGE_SCANS);
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

      // 3. New v6 Review & Quality Control stores (System #4)
      if (!db.objectStoreNames.contains(STORE_REVIEW_FINDINGS)) {
        const findingStore = db.createObjectStore(STORE_REVIEW_FINDINGS, { keyPath: 'findingId' });
        findingStore.createIndex('pageId', 'affectedEntity.pageId', { unique: false });
        findingStore.createIndex('bubbleId', 'affectedEntity.bubbleId', { unique: false });
        findingStore.createIndex('domain', 'domain', { unique: false });
        findingStore.createIndex('status', 'status', { unique: false });
        findingStore.createIndex('issueCode', 'issueCode', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_REVIEW_SNAPSHOTS)) {
        const revSnapStore = db.createObjectStore(STORE_REVIEW_SNAPSHOTS, { keyPath: 'snapshotId' });
        revSnapStore.createIndex('pageId', 'pageId', { unique: false });
        revSnapStore.createIndex('chapterId', 'chapterId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_REVIEW_AUDIT)) {
        const auditStore = db.createObjectStore(STORE_REVIEW_AUDIT, { keyPath: 'auditId' });
        auditStore.createIndex('snapshotId', 'snapshotId', { unique: false });
        auditStore.createIndex('findingId', 'findingId', { unique: false });
        auditStore.createIndex('jobId', 'jobId', { unique: false });
      }

      // 4. New v7 Project Memory & AI Data Integrity stores (System #5)
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_RECORDS)) {
        const recordStore = db.createObjectStore(STORE_KNOWLEDGE_RECORDS, { keyPath: 'record_id' });
        recordStore.createIndex('projectId', 'project_id', { unique: false });
        recordStore.createIndex('recordType', 'record_type', { unique: false });
        recordStore.createIndex('canonicalKey', 'canonical_key', { unique: false });
        recordStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_REVISIONS)) {
        const revStore = db.createObjectStore(STORE_KNOWLEDGE_REVISIONS, { keyPath: 'revision_id' });
        revStore.createIndex('recordId', 'record_id', { unique: false });
        revStore.createIndex('projectId', 'project_id', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_CANDIDATES)) {
        const candStore = db.createObjectStore(STORE_KNOWLEDGE_CANDIDATES, { keyPath: 'candidate_id' });
        candStore.createIndex('projectId', 'project_id', { unique: false });
        candStore.createIndex('dedupeKey', 'dedupe_key', { unique: false });
        candStore.createIndex('status', 'status', { unique: false });
        candStore.createIndex('reviewState', 'review_state', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_AUDIT)) {
        const knowAuditStore = db.createObjectStore(STORE_KNOWLEDGE_AUDIT, { keyPath: 'event_id' });
        knowAuditStore.createIndex('projectId', 'project_id', { unique: false });
        knowAuditStore.createIndex('recordId', 'record_id', { unique: false });
        knowAuditStore.createIndex('correlationId', 'correlation_id', { unique: false });
        knowAuditStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_QUARANTINE)) {
        const quarStore = db.createObjectStore(STORE_KNOWLEDGE_QUARANTINE, { keyPath: 'quarantine_id' });
        quarStore.createIndex('projectId', 'project_id', { unique: false });
        quarStore.createIndex('producer', 'producer', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_CONFLICTS)) {
        const confStore = db.createObjectStore(STORE_KNOWLEDGE_CONFLICTS, { keyPath: 'conflict_id' });
        confStore.createIndex('projectId', 'project_id', { unique: false });
        confStore.createIndex('canonicalKey', 'canonical_key', { unique: false });
        confStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_KNOWLEDGE_IDEMPOTENCY)) {
        db.createObjectStore(STORE_KNOWLEDGE_IDEMPOTENCY, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY_SETTINGS)) {
        db.createObjectStore(STORE_MEMORY_SETTINGS, { keyPath: 'project_id' });
      }
      if (!db.objectStoreNames.contains(STORE_TRAINING_REFERENCE_SETS)) {
        const refStore = db.createObjectStore(STORE_TRAINING_REFERENCE_SETS, { keyPath: 'id' });
        refStore.createIndex('enabled', 'enabled', { unique: false });
        refStore.createIndex('priority', 'priority', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TRAINING_BLOBS)) {
        db.createObjectStore(STORE_TRAINING_BLOBS);
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
// SYSTEM #3: CANONICAL PAGE SCANS
// ==========================================

export async function savePageScan(pageId: string, scan: PageScanResult): Promise<void> {
  const db = await getDatabase();
  const key = `page-scan:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_SCANS, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_SCANS);
    const request = store.put(scan, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPageScan(pageId: string): Promise<PageScanResult | null> {
  const db = await getDatabase();
  const key = `page-scan:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_SCANS, 'readonly');
    const store = tx.objectStore(STORE_PAGE_SCANS);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deletePageScan(pageId: string): Promise<void> {
  const db = await getDatabase();
  const key = `page-scan:${pageId}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PAGE_SCANS, 'readwrite');
    const store = tx.objectStore(STORE_PAGE_SCANS);
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
// SYSTEM #4: CANONICAL REVIEW FINDINGS & AUDIT (IndexedDB v6)
// ==========================================

export async function saveReviewFinding(finding: ReviewFinding): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    const request = store.put(finding);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveReviewFindings(findings: ReviewFinding[]): Promise<void> {
  if (!findings || findings.length === 0) return;
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    for (const f of findings) {
      store.put(f);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted saving review findings'));
  });
}

export async function getReviewFindingsForPage(pageId: string): Promise<ReviewFinding[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    const index = store.index('pageId');
    const request = index.getAll(pageId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getReviewFindingsForBubble(bubbleId: string): Promise<ReviewFinding[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    const index = store.index('bubbleId');
    const request = index.getAll(bubbleId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getReviewFinding(findingId: string): Promise<ReviewFinding | null> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    const request = store.get(findingId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function updateReviewFindingStatus(
  findingId: string,
  status: FindingStatus,
  resolutionDetail?: string,
  resolvedBy: 'user' | 'system' = 'user'
): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    const getReq = store.get(findingId);

    getReq.onsuccess = () => {
      const finding: ReviewFinding = getReq.result;
      if (!finding) {
        resolve();
        return;
      }
      finding.status = status;
      finding.resolvedAt = Date.now();
      finding.resolvedBy = resolvedBy;
      if (resolutionDetail) {
        finding.resolutionDetail = resolutionDetail;
      }
      const putReq = store.put(finding);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteReviewFindingsForPage(pageId: string): Promise<void> {
  const db = await getDatabase();
  const findings = await getReviewFindingsForPage(pageId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_FINDINGS, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_FINDINGS);
    for (const f of findings) {
      store.delete(f.findingId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveReviewSnapshot(snapshot: ReviewSnapshot): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_SNAPSHOTS);
    const request = store.put(snapshot);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getReviewSnapshot(snapshotId: string): Promise<ReviewSnapshot | null> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_SNAPSHOTS);
    const request = store.get(snapshotId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReviewAuditRecord(record: ReviewAuditRecord): Promise<void> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_AUDIT, 'readwrite');
    const store = tx.objectStore(STORE_REVIEW_AUDIT);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getReviewAuditRecords(findingId: string): Promise<ReviewAuditRecord[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_AUDIT, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_AUDIT);
    const index = store.index('findingId');
    const request = index.getAll(findingId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getReviewAuditRecordsForJob(jobId: string): Promise<ReviewAuditRecord[]> {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_REVIEW_AUDIT, 'readonly');
    const store = tx.objectStore(STORE_REVIEW_AUDIT);
    const index = store.index('jobId');
    const request = index.getAll(jobId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// ==========================================
// CANONICAL FINDINGS <-> WORKSPACE FLAG ADAPTER
// ==========================================

export function mapSeverityToReviewSeverity(severity?: string): ReviewSeverity {
  switch (severity) {
    case 'blocker':
    case 'critical':
      return 'critical';
    case 'major':
      return 'major';
    case 'warning':
    case 'moderate':
      return 'moderate';
    case 'minor':
      return 'minor';
    case 'suggestion':
    case 'informational':
    default:
      return 'informational';
  }
}

export function mapReviewSeverityToFlagSeverity(severity: ReviewSeverity): ReviewFlagSeverity {
  switch (severity) {
    case 'critical':
      return 'blocker';
    case 'major':
    case 'moderate':
      return 'warning';
    case 'minor':
    case 'informational':
    default:
      return 'suggestion';
  }
}

export function mapCategoryToReviewDomain(category: ReviewFlagCategory): ReviewDomain {
  switch (category) {
    case 'missed_bubble':
    case 'remove_bubble':
      return 'visual';
    case 'ocr_error':
      return 'ocr';
    case 'reading_order':
      return 'reading_order';
    case 'typer_tag':
      return 'classification';
    case 'grammar_gender':
    case 'ambiguous_flow':
    case 'name_inconsistency':
      return 'translation';
    case 'overflow_warning':
    default:
      return 'cross_layer';
  }
}

export function reviewFindingToReviewFlagItem(finding: ReviewFinding): ReviewFlagItem {
  // Convert domain + issueCode to existing ReviewFlagCategory for UI backward compatibility
  let category: ReviewFlagCategory = 'ambiguous_flow';
  if (finding.domain === 'ocr' || finding.issueCode.includes('OCR')) {
    category = 'ocr_error';
  } else if (finding.issueCode === 'MISSED_TEXT_IN_ART' || finding.issueCode === 'MISSED_BUBBLE') {
    category = 'missed_bubble';
  } else if (finding.issueCode === 'REMOVE_BUBBLE') {
    category = 'remove_bubble';
  } else if (finding.domain === 'reading_order' || finding.issueCode.includes('ORDER')) {
    category = 'reading_order';
  } else if (finding.domain === 'classification' || finding.issueCode.includes('TYPE')) {
    category = 'typer_tag';
  } else if (finding.issueCode === 'NAME_INCONSISTENCY' || finding.issueCode === 'TERMINOLOGY_INCONSISTENCY') {
    category = 'name_inconsistency';
  } else if (finding.issueCode.includes('GENDER') || finding.issueCode === 'GRAMMAR_ERROR') {
    category = 'grammar_gender';
  } else if (finding.issueCode === 'TEXT_CLIPPED' || finding.issueCode === 'OVERFLOW_WARNING') {
    category = 'overflow_warning';
  }

  const confidenceScore =
    finding.confidence.finding === 'high' ? 0.95 :
    finding.confidence.finding === 'moderate' ? 0.75 : 0.5;

  return {
    id: finding.findingId,
    category,
    severity: mapReviewSeverityToFlagSeverity(finding.severity),
    reasonAr: finding.observation,
    evidence: finding.evidence.rationale || finding.evidence.sourceSpan || finding.evidence.detectedOCR,
    suggestedTextAr: finding.proposedCorrection?.targetField === 'translatedText'
      ? String(finding.proposedCorrection.suggestedValue || '')
      : undefined,
    suggestedType: finding.proposedCorrection?.targetField === 'type'
      ? String(finding.proposedCorrection.suggestedValue || '')
      : undefined,
    suggestedOrderIndex: finding.proposedCorrection?.targetField === 'orderIndex'
      ? Number(finding.proposedCorrection.suggestedValue)
      : undefined,
    status: finding.status === 'accepted' ? 'accepted' : finding.status === 'rejected' ? 'dismissed' : 'pending',
    confidence: confidenceScore,
    createdAt: finding.createdAt,
    resolvedAt: finding.resolvedAt,
    resolutionDetail: finding.resolutionDetail,
  };
}

export function reviewFlagItemToReviewFinding(
  flag: ReviewFlagItem,
  pageId: string,
  bubbleId?: string,
  snapshotVersion: string = 'v1'
): ReviewFinding {
  const domain = mapCategoryToReviewDomain(flag.category);
  const severity = mapSeverityToReviewSeverity(flag.severity);

  return {
    findingId: flag.id,
    domain,
    issueCode: flag.category.toUpperCase(),
    severity,
    status: flag.status === 'accepted' ? 'accepted' : flag.status === 'dismissed' ? 'rejected' : 'open',
    affectedEntity: {
      type: bubbleId ? 'bubble' : 'page',
      pageId,
      bubbleId,
    },
    observation: flag.reasonAr,
    expectedBehavior: 'Satisfy scanlation and translation quality criteria.',
    evidence: {
      rationale: flag.evidence || flag.reasonAr,
    },
    confidence: {
      sourceOCR: 'moderate',
      finding: flag.confidence && flag.confidence > 0.8 ? 'high' : 'moderate',
      correction: flag.suggestedTextAr ? 'moderate' : 'not_assessed',
    },
    proposedAction: flag.suggestedTextAr ? 'edit' : 'inspect',
    proposedCorrection: flag.suggestedTextAr
      ? {
          correctionId: `corr-${flag.id}`,
          targetField: 'translatedText',
          currentValue: '',
          suggestedValue: flag.suggestedTextAr,
          isEligibleForAuto: false,
          validationStatus: 'pending',
        }
      : undefined,
    ruleVersion: 'system4-v1.0',
    createdAt: flag.createdAt || Date.now(),
    resolvedAt: flag.resolvedAt,
    resolutionDetail: flag.resolutionDetail,
    snapshotVersion,
  };
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

    // Record schema journal entries for v6 (Review) and v7 (Project Memory) (F-26)
    const v6Journal: MigrationJournalEntry = {
      key: 'storage_v6_review_schema',
      version: 6,
      status: 'completed',
      timestamp: Date.now(),
      migratedProjectsCount: journalEntry.migratedProjectsCount,
      migratedChaptersCount: journalEntry.migratedChaptersCount,
      migratedPagesCount: journalEntry.migratedPagesCount,
    };
    await saveJournalEntry(db, v6Journal);

    const v7Journal: MigrationJournalEntry = {
      key: 'storage_v7_memory_schema',
      version: 7,
      status: 'completed',
      timestamp: Date.now(),
      migratedProjectsCount: journalEntry.migratedProjectsCount,
      migratedChaptersCount: journalEntry.migratedChaptersCount,
      migratedPagesCount: journalEntry.migratedPagesCount,
    };
    await saveJournalEntry(db, v7Journal);

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
