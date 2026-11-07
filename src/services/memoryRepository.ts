/**
 * Dragonfly 44: System #5 — Memory Repository & Storage Layer
 * 
 * Provides concurrency-safe, versioned, transactional persistence for Knowledge Records,
 * Revisions, Candidates, Audit Events, Conflicts, Quarantine, and Idempotency logs.
 * Supports both IndexedDB (browser/Electron) and High-Fidelity InMemory (Node/benchmark/fallback).
 */

import type {
  KnowledgeRecord,
  KnowledgeRevision,
  KnowledgeCandidate,
  KnowledgeAuditEvent,
  KnowledgeConflictSet,
  KnowledgeQuarantineItem,
  ProjectMemorySettings,
  CandidateReviewState,
  RecordType,
  ScopeLevel,
} from '../types/memory';
import { DEFAULT_PROJECT_MEMORY_SETTINGS } from '../types/memory';
import { getDatabase } from './db';

// Store Names matching IndexedDB v7
export const STORE_KNOWLEDGE_RECORDS = 'knowledge_records';
export const STORE_KNOWLEDGE_REVISIONS = 'knowledge_revisions';
export const STORE_KNOWLEDGE_CANDIDATES = 'knowledge_candidates';
export const STORE_KNOWLEDGE_AUDIT = 'knowledge_audit';
export const STORE_KNOWLEDGE_QUARANTINE = 'knowledge_quarantine';
export const STORE_KNOWLEDGE_CONFLICTS = 'knowledge_conflicts';
export const STORE_KNOWLEDGE_IDEMPOTENCY = 'knowledge_idempotency';
export const STORE_MEMORY_SETTINGS = 'memory_settings';

export interface CasResult {
  success: boolean;
  newRevision?: number;
  conflict?: {
    currentRevision: number;
    currentRecord: KnowledgeRecord;
  };
  error?: string;
}

export interface IMemoryDriver {
  getRecord(recordId: string): Promise<KnowledgeRecord | null>;
  getRecordsByProject(projectId: string): Promise<KnowledgeRecord[]>;
  getRecordsByCanonicalKey(projectId: string, canonicalKey: string): Promise<KnowledgeRecord[]>;
  getRecordsByType(projectId: string, recordType: RecordType): Promise<KnowledgeRecord[]>;
  getRecordsByScope(projectId: string, scopeLevel: ScopeLevel, scopeId?: string): Promise<KnowledgeRecord[]>;
  saveRecordAtomic(
    record: KnowledgeRecord,
    expectedRevision: number | null,
    auditEvent: KnowledgeAuditEvent
  ): Promise<CasResult>;
  getRevisions(recordId: string): Promise<KnowledgeRevision[]>;
  getCandidate(candidateId: string): Promise<KnowledgeCandidate | null>;
  getCandidatesByProject(projectId: string): Promise<KnowledgeCandidate[]>;
  getCandidateByDedupeKey(projectId: string, dedupeKey: string): Promise<KnowledgeCandidate | null>;
  saveCandidate(candidate: KnowledgeCandidate): Promise<void>;
  updateCandidateState(candidateId: string, reviewState: CandidateReviewState): Promise<void>;
  deleteCandidate(candidateId: string): Promise<void>;
  getIdempotencyRecord(key: string): Promise<any | null>;
  saveIdempotencyRecord(key: string, result: any): Promise<void>;
  saveAuditEvent(event: KnowledgeAuditEvent): Promise<void>;
  getAuditEventsForRecord(recordId: string): Promise<KnowledgeAuditEvent[]>;
  getAuditEventsForProject(projectId: string): Promise<KnowledgeAuditEvent[]>;
  getConflict(conflictId: string): Promise<KnowledgeConflictSet | null>;
  getConflictsByProject(projectId: string): Promise<KnowledgeConflictSet[]>;
  saveConflict(conflict: KnowledgeConflictSet): Promise<void>;
  saveQuarantineItem(item: KnowledgeQuarantineItem): Promise<void>;
  getQuarantineItems(projectId: string): Promise<KnowledgeQuarantineItem[]>;
  getProjectSettings(projectId: string): Promise<ProjectMemorySettings>;
  saveProjectSettings(settings: ProjectMemorySettings): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

function deepClone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

// ----------------------------------------------------
// In-Memory Storage Driver (Test, Node, Fallback)
// ----------------------------------------------------

export class InMemoryMemoryDriver implements IMemoryDriver {
  private records = new Map<string, KnowledgeRecord>();
  private revisions = new Map<string, KnowledgeRevision[]>(); // recordId -> revisions
  private candidates = new Map<string, KnowledgeCandidate>();
  private auditEvents = new Map<string, KnowledgeAuditEvent[]>(); // projectId -> events
  private conflicts = new Map<string, KnowledgeConflictSet>();
  private quarantine = new Map<string, KnowledgeQuarantineItem[]>(); // projectId -> items
  private idempotency = new Map<string, any>();
  private settings = new Map<string, ProjectMemorySettings>();

  // Failure simulation flag for testing atomicity rollback
  public simulateAuditFailure = false;

  async getRecord(recordId: string): Promise<KnowledgeRecord | null> {
    const r = this.records.get(recordId);
    return r ? deepClone(r) : null;
  }

  async getRecordsByProject(projectId: string): Promise<KnowledgeRecord[]> {
    const result: KnowledgeRecord[] = [];
    for (const r of this.records.values()) {
      if (r.project_id === projectId) {
        result.push(deepClone(r));
      }
    }
    return result;
  }

  async getRecordsByCanonicalKey(projectId: string, canonicalKey: string): Promise<KnowledgeRecord[]> {
    const result: KnowledgeRecord[] = [];
    for (const r of this.records.values()) {
      if (r.project_id === projectId && r.canonical_key === canonicalKey) {
        result.push(deepClone(r));
      }
    }
    return result;
  }

  async getRecordsByType(projectId: string, recordType: RecordType): Promise<KnowledgeRecord[]> {
    const result: KnowledgeRecord[] = [];
    for (const r of this.records.values()) {
      if (r.project_id === projectId && r.record_type === recordType) {
        result.push(deepClone(r));
      }
    }
    return result;
  }

  async getRecordsByScope(projectId: string, scopeLevel: ScopeLevel, scopeId?: string): Promise<KnowledgeRecord[]> {
    const result: KnowledgeRecord[] = [];
    for (const r of this.records.values()) {
      if (r.project_id === projectId && r.scope.level === scopeLevel) {
        if (!scopeId || r.scope.id === scopeId) {
          result.push(deepClone(r));
        }
      }
    }
    return result;
  }

  async saveRecordAtomic(
    record: KnowledgeRecord,
    expectedRevision: number | null,
    auditEvent: KnowledgeAuditEvent
  ): Promise<CasResult> {
    const existing = this.records.get(record.record_id);

    // Compare-and-Swap Revision Check
    if (existing) {
      if (expectedRevision === null || existing.revision !== expectedRevision) {
        return {
          success: false,
          conflict: {
            currentRevision: existing.revision,
            currentRecord: deepClone(existing),
          },
          error: `Compare-and-swap failed. Expected revision ${expectedRevision}, but found ${existing.revision}`,
        };
      }
    } else if (expectedRevision !== null && expectedRevision !== 0) {
      return {
        success: false,
        error: `Cannot update non-existent record ${record.record_id} with expectedRevision ${expectedRevision}`,
      };
    }

    // Atomic simulation of write + audit
    const backupRecord = existing ? deepClone(existing) : null;
    const nextRevision = existing ? existing.revision + 1 : 1;
    const recordToCommit = deepClone(record);
    recordToCommit.revision = nextRevision;
    recordToCommit.updated_at = Date.now();

    const revisionEntry: KnowledgeRevision = {
      revision_id: `rev-${recordToCommit.record_id}-${nextRevision}`,
      record_id: recordToCommit.record_id,
      project_id: recordToCommit.project_id,
      revision: nextRevision,
      snapshot_data: deepClone(recordToCommit),
      changed_by: auditEvent.actor,
      timestamp: Date.now(),
      change_reason: auditEvent.decision_reason,
      previous_revision: existing ? existing.revision : undefined,
    };

    // If audit failure is simulated, abort write to guarantee atomicity invariant
    if (this.simulateAuditFailure) {
      return {
        success: false,
        error: 'Simulated audit transaction failure: record write rolled back',
      };
    }

    try {
      this.records.set(recordToCommit.record_id, recordToCommit);
      
      const revList = this.revisions.get(recordToCommit.record_id) || [];
      revList.push(revisionEntry);
      this.revisions.set(recordToCommit.record_id, revList);

      const events = this.auditEvents.get(recordToCommit.project_id) || [];
      auditEvent.before_revision = existing ? existing.revision : undefined;
      auditEvent.after_revision = nextRevision;
      auditEvent.result = 'success';
      events.push(deepClone(auditEvent));
      this.auditEvents.set(recordToCommit.project_id, events);

      return {
        success: true,
        newRevision: nextRevision,
      };
    } catch (err: any) {
      // Rollback on any failure
      if (backupRecord) {
        this.records.set(backupRecord.record_id, backupRecord);
      } else {
        this.records.delete(record.record_id);
      }
      return {
        success: false,
        error: `Atomic commit failed and rolled back: ${err?.message || String(err)}`,
      };
    }
  }

  async getRevisions(recordId: string): Promise<KnowledgeRevision[]> {
    const list = this.revisions.get(recordId) || [];
    return deepClone(list);
  }

  async getCandidate(candidateId: string): Promise<KnowledgeCandidate | null> {
    const c = this.candidates.get(candidateId);
    return c ? deepClone(c) : null;
  }

  async getCandidatesByProject(projectId: string): Promise<KnowledgeCandidate[]> {
    const res: KnowledgeCandidate[] = [];
    for (const c of this.candidates.values()) {
      if (c.project_id === projectId) {
        res.push(deepClone(c));
      }
    }
    return res;
  }

  async getCandidateByDedupeKey(projectId: string, dedupeKey: string): Promise<KnowledgeCandidate | null> {
    for (const c of this.candidates.values()) {
      if (c.project_id === projectId && c.dedupe_key === dedupeKey) {
        return deepClone(c);
      }
    }
    return null;
  }

  async saveCandidate(candidate: KnowledgeCandidate): Promise<void> {
    this.candidates.set(candidate.candidate_id, deepClone(candidate));
  }

  async updateCandidateState(candidateId: string, reviewState: CandidateReviewState): Promise<void> {
    const c = this.candidates.get(candidateId);
    if (c) {
      c.review_state = reviewState;
    }
  }

  async deleteCandidate(candidateId: string): Promise<void> {
    this.candidates.delete(candidateId);
  }

  async getIdempotencyRecord(key: string): Promise<any | null> {
    const rec = this.idempotency.get(key);
    return rec ? deepClone(rec) : null;
  }

  async saveIdempotencyRecord(key: string, result: any): Promise<void> {
    this.idempotency.set(key, deepClone(result));
  }

  async saveAuditEvent(event: KnowledgeAuditEvent): Promise<void> {
    if (this.simulateAuditFailure) {
      throw new Error('Simulated audit write failure');
    }
    const events = this.auditEvents.get(event.project_id) || [];
    events.push(deepClone(event));
    this.auditEvents.set(event.project_id, events);
  }

  async getAuditEventsForRecord(recordId: string): Promise<KnowledgeAuditEvent[]> {
    const result: KnowledgeAuditEvent[] = [];
    for (const events of this.auditEvents.values()) {
      for (const e of events) {
        if (e.record_id === recordId) {
          result.push(deepClone(e));
        }
      }
    }
    return result;
  }

  async getAuditEventsForProject(projectId: string): Promise<KnowledgeAuditEvent[]> {
    const events = this.auditEvents.get(projectId) || [];
    return deepClone(events);
  }

  async getConflict(conflictId: string): Promise<KnowledgeConflictSet | null> {
    const c = this.conflicts.get(conflictId);
    return c ? deepClone(c) : null;
  }

  async getConflictsByProject(projectId: string): Promise<KnowledgeConflictSet[]> {
    const res: KnowledgeConflictSet[] = [];
    for (const c of this.conflicts.values()) {
      if (c.project_id === projectId) {
        res.push(deepClone(c));
      }
    }
    return res;
  }

  async saveConflict(conflict: KnowledgeConflictSet): Promise<void> {
    this.conflicts.set(conflict.conflict_id, deepClone(conflict));
  }

  async saveQuarantineItem(item: KnowledgeQuarantineItem): Promise<void> {
    const list = this.quarantine.get(item.project_id) || [];
    list.push(deepClone(item));
    // Keep quarantine bounded
    if (list.length > 500) {
      list.shift();
    }
    this.quarantine.set(item.project_id, list);
  }

  async getQuarantineItems(projectId: string): Promise<KnowledgeQuarantineItem[]> {
    const list = this.quarantine.get(projectId) || [];
    return deepClone(list);
  }

  async getProjectSettings(projectId: string): Promise<ProjectMemorySettings> {
    const s = this.settings.get(projectId);
    if (s) return deepClone(s);
    return {
      project_id: projectId,
      ...DEFAULT_PROJECT_MEMORY_SETTINGS,
      updated_at: Date.now(),
    };
  }

  async saveProjectSettings(settings: ProjectMemorySettings): Promise<void> {
    this.settings.set(settings.project_id, deepClone(settings));
  }

  async clearProject(projectId: string): Promise<void> {
    for (const [id, rec] of this.records.entries()) {
      if (rec.project_id === projectId) {
        this.records.delete(id);
        this.revisions.delete(id);
      }
    }
    for (const [id, cand] of this.candidates.entries()) {
      if (cand.project_id === projectId) {
        this.candidates.delete(id);
      }
    }
    for (const [id, conf] of this.conflicts.entries()) {
      if (conf.project_id === projectId) {
        this.conflicts.delete(id);
      }
    }
    this.auditEvents.delete(projectId);
    this.quarantine.delete(projectId);
    this.settings.delete(projectId);
  }
}

// ----------------------------------------------------
// IndexedDB Storage Driver (Browser / Electron)
// ----------------------------------------------------

export class IndexedDBMemoryDriver implements IMemoryDriver {
  private inMemoryFallback = new InMemoryMemoryDriver();

  private isIndexedDBAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  async getRecord(recordId: string): Promise<KnowledgeRecord | null> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRecord(recordId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_RECORDS, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_RECORDS);
        const req = store.get(recordId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getRecord(recordId);
    }
  }

  async getRecordsByProject(projectId: string): Promise<KnowledgeRecord[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRecordsByProject(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_RECORDS, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_RECORDS);
        const index = store.index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getRecordsByProject(projectId);
    }
  }

  async getRecordsByCanonicalKey(projectId: string, canonicalKey: string): Promise<KnowledgeRecord[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRecordsByCanonicalKey(projectId, canonicalKey);
    try {
      const records = await this.getRecordsByProject(projectId);
      return records.filter((r) => r.canonical_key === canonicalKey);
    } catch {
      return this.inMemoryFallback.getRecordsByCanonicalKey(projectId, canonicalKey);
    }
  }

  async getRecordsByType(projectId: string, recordType: RecordType): Promise<KnowledgeRecord[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRecordsByType(projectId, recordType);
    try {
      const records = await this.getRecordsByProject(projectId);
      return records.filter((r) => r.record_type === recordType);
    } catch {
      return this.inMemoryFallback.getRecordsByType(projectId, recordType);
    }
  }

  async getRecordsByScope(projectId: string, scopeLevel: ScopeLevel, scopeId?: string): Promise<KnowledgeRecord[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRecordsByScope(projectId, scopeLevel, scopeId);
    try {
      const records = await this.getRecordsByProject(projectId);
      return records.filter((r) => r.scope.level === scopeLevel && (!scopeId || r.scope.id === scopeId));
    } catch {
      return this.inMemoryFallback.getRecordsByScope(projectId, scopeLevel, scopeId);
    }
  }

  async saveRecordAtomic(
    record: KnowledgeRecord,
    expectedRevision: number | null,
    auditEvent: KnowledgeAuditEvent
  ): Promise<CasResult> {
    if (!this.isIndexedDBAvailable()) {
      return this.inMemoryFallback.saveRecordAtomic(record, expectedRevision, auditEvent);
    }

    try {
      const db = await getDatabase();
      return new Promise((resolve) => {
        const tx = db.transaction(
          [STORE_KNOWLEDGE_RECORDS, STORE_KNOWLEDGE_REVISIONS, STORE_KNOWLEDGE_AUDIT],
          'readwrite'
        );
        const recordStore = tx.objectStore(STORE_KNOWLEDGE_RECORDS);
        const revisionStore = tx.objectStore(STORE_KNOWLEDGE_REVISIONS);
        const auditStore = tx.objectStore(STORE_KNOWLEDGE_AUDIT);

        const getReq = recordStore.get(record.record_id);

        getReq.onsuccess = () => {
          const current: KnowledgeRecord | undefined = getReq.result;

          // Concurrency Check
          if (current) {
            if (expectedRevision === null || current.revision !== expectedRevision) {
              resolve({
                success: false,
                conflict: {
                  currentRevision: current.revision,
                  currentRecord: current,
                },
                error: `Stale revision conflict: expected ${expectedRevision}, current is ${current.revision}`,
              });
              return;
            }
          } else if (expectedRevision !== null && expectedRevision !== 0) {
            resolve({
              success: false,
              error: `Record ${record.record_id} does not exist to update at revision ${expectedRevision}`,
            });
            return;
          }

          const nextRevision = current ? current.revision + 1 : 1;
          const updatedRecord: KnowledgeRecord = {
            ...record,
            revision: nextRevision,
            updated_at: Date.now(),
          };

          const revisionItem: KnowledgeRevision = {
            revision_id: `rev-${record.record_id}-${nextRevision}`,
            record_id: record.record_id,
            project_id: record.project_id,
            revision: nextRevision,
            snapshot_data: updatedRecord,
            changed_by: auditEvent.actor,
            timestamp: Date.now(),
            change_reason: auditEvent.decision_reason,
            previous_revision: current ? current.revision : undefined,
          };

          const finalizedAuditEvent: KnowledgeAuditEvent = {
            ...auditEvent,
            before_revision: current ? current.revision : undefined,
            after_revision: nextRevision,
            timestamp: Date.now(),
            result: 'success',
          };

          recordStore.put(updatedRecord);
          revisionStore.put(revisionItem);
          auditStore.put(finalizedAuditEvent);
        };

        tx.oncomplete = () => {
          // Keep fallback in sync
          this.inMemoryFallback.saveRecordAtomic(record, expectedRevision, auditEvent).catch(() => {});
          resolve({ success: true, newRevision: (record.revision || 0) + 1 });
        };

        tx.onerror = () => {
          resolve({
            success: false,
            error: `Atomic IndexedDB transaction aborted: ${tx.error?.message || 'unknown'}`,
          });
        };
      });
    } catch (err: any) {
      // In browser/Electron production runtime, surface persistence failure (F-19)
      if (typeof window !== 'undefined') {
        console.error('[MemoryRepository] Durable IndexedDB write failed:', err);
        return {
          success: false,
          error: `Durable IndexedDB write failure: ${err?.message || String(err)}`,
        };
      }
      return this.inMemoryFallback.saveRecordAtomic(record, expectedRevision, auditEvent);
    }
  }

  async getRevisions(recordId: string): Promise<KnowledgeRevision[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getRevisions(recordId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_REVISIONS, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_REVISIONS);
        const index = store.index('recordId');
        const req = index.getAll(recordId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getRevisions(recordId);
    }
  }

  async getCandidate(candidateId: string): Promise<KnowledgeCandidate | null> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getCandidate(candidateId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CANDIDATES, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_CANDIDATES);
        const req = store.get(candidateId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getCandidate(candidateId);
    }
  }

  async getCandidatesByProject(projectId: string): Promise<KnowledgeCandidate[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getCandidatesByProject(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CANDIDATES, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_CANDIDATES);
        const index = store.index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getCandidatesByProject(projectId);
    }
  }

  async getCandidateByDedupeKey(projectId: string, dedupeKey: string): Promise<KnowledgeCandidate | null> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getCandidateByDedupeKey(projectId, dedupeKey);
    try {
      const candidates = await this.getCandidatesByProject(projectId);
      return candidates.find((c) => c.dedupe_key === dedupeKey) || null;
    } catch {
      return this.inMemoryFallback.getCandidateByDedupeKey(projectId, dedupeKey);
    }
  }

  async saveCandidate(candidate: KnowledgeCandidate): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveCandidate(candidate);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CANDIDATES, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_CANDIDATES);
        const req = store.put(candidate);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveCandidate(candidate).catch(() => {});
    } catch {
      return this.inMemoryFallback.saveCandidate(candidate);
    }
  }

  async updateCandidateState(candidateId: string, reviewState: CandidateReviewState): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.updateCandidateState(candidateId, reviewState);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CANDIDATES, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_CANDIDATES);
        const getReq = store.get(candidateId);
        getReq.onsuccess = () => {
          const c: KnowledgeCandidate = getReq.result;
          if (c) {
            c.review_state = reviewState;
            store.put(c);
          }
          resolve();
        };
        getReq.onerror = () => reject(getReq.error);
      });
      this.inMemoryFallback.updateCandidateState(candidateId, reviewState).catch(() => {});
    } catch {
      return this.inMemoryFallback.updateCandidateState(candidateId, reviewState);
    }
  }

  async deleteCandidate(candidateId: string): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.deleteCandidate(candidateId);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CANDIDATES, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_CANDIDATES);
        const req = store.delete(candidateId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.deleteCandidate(candidateId).catch(() => {});
    } catch {
      return this.inMemoryFallback.deleteCandidate(candidateId);
    }
  }

  async getIdempotencyRecord(key: string): Promise<any | null> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getIdempotencyRecord(key);
    try {
      const db = await getDatabase();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_KNOWLEDGE_IDEMPOTENCY, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_IDEMPOTENCY);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return this.inMemoryFallback.getIdempotencyRecord(key);
    }
  }

  async saveIdempotencyRecord(key: string, result: any): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveIdempotencyRecord(key, result);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_IDEMPOTENCY, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_IDEMPOTENCY);
        const req = store.put({ key, data: result, timestamp: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveIdempotencyRecord(key, result).catch(() => {});
    } catch {
      return this.inMemoryFallback.saveIdempotencyRecord(key, result);
    }
  }

  async saveAuditEvent(event: KnowledgeAuditEvent): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveAuditEvent(event);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_AUDIT, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_AUDIT);
        const req = store.put(event);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveAuditEvent(event).catch(() => {});
    } catch {
      return this.inMemoryFallback.saveAuditEvent(event);
    }
  }

  async getAuditEventsForRecord(recordId: string): Promise<KnowledgeAuditEvent[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getAuditEventsForRecord(recordId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_AUDIT, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_AUDIT);
        const index = store.index('recordId');
        const req = index.getAll(recordId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getAuditEventsForRecord(recordId);
    }
  }

  async getAuditEventsForProject(projectId: string): Promise<KnowledgeAuditEvent[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getAuditEventsForProject(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_AUDIT, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_AUDIT);
        const index = store.index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getAuditEventsForProject(projectId);
    }
  }

  async getConflict(conflictId: string): Promise<KnowledgeConflictSet | null> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getConflict(conflictId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CONFLICTS, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_CONFLICTS);
        const req = store.get(conflictId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getConflict(conflictId);
    }
  }

  async getConflictsByProject(projectId: string): Promise<KnowledgeConflictSet[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getConflictsByProject(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CONFLICTS, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_CONFLICTS);
        const index = store.index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getConflictsByProject(projectId);
    }
  }

  async saveConflict(conflict: KnowledgeConflictSet): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveConflict(conflict);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_CONFLICTS, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_CONFLICTS);
        const req = store.put(conflict);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveConflict(conflict).catch(() => {});
    } catch {
      return this.inMemoryFallback.saveConflict(conflict);
    }
  }

  async saveQuarantineItem(item: KnowledgeQuarantineItem): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveQuarantineItem(item);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_QUARANTINE, 'readwrite');
        const store = tx.objectStore(STORE_KNOWLEDGE_QUARANTINE);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveQuarantineItem(item).catch(() => {});
    } catch {
      return this.inMemoryFallback.saveQuarantineItem(item);
    }
  }

  async getQuarantineItems(projectId: string): Promise<KnowledgeQuarantineItem[]> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getQuarantineItems(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KNOWLEDGE_QUARANTINE, 'readonly');
        const store = tx.objectStore(STORE_KNOWLEDGE_QUARANTINE);
        const index = store.index('projectId');
        const req = index.getAll(projectId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.inMemoryFallback.getQuarantineItems(projectId);
    }
  }

  async getProjectSettings(projectId: string): Promise<ProjectMemorySettings> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.getProjectSettings(projectId);
    try {
      const db = await getDatabase();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_MEMORY_SETTINGS, 'readonly');
        const store = tx.objectStore(STORE_MEMORY_SETTINGS);
        const req = store.get(projectId);
        req.onsuccess = () => {
          if (req.result) resolve(req.result);
          else {
            resolve({
              project_id: projectId,
              ...DEFAULT_PROJECT_MEMORY_SETTINGS,
              updated_at: Date.now(),
            });
          }
        };
        req.onerror = () =>
          resolve({
            project_id: projectId,
            ...DEFAULT_PROJECT_MEMORY_SETTINGS,
            updated_at: Date.now(),
          });
      });
    } catch {
      return this.inMemoryFallback.getProjectSettings(projectId);
    }
  }

  async saveProjectSettings(settings: ProjectMemorySettings): Promise<void> {
    if (!this.isIndexedDBAvailable()) return this.inMemoryFallback.saveProjectSettings(settings);
    try {
      const db = await getDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MEMORY_SETTINGS, 'readwrite');
        const store = tx.objectStore(STORE_MEMORY_SETTINGS);
        const req = store.put(settings);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.inMemoryFallback.saveProjectSettings(settings).catch(() => {});
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        console.error('[MemoryRepository] Failed to save memory settings to IndexedDB:', err);
        throw new Error(`Failed to save memory settings to IndexedDB: ${err?.message || String(err)}`);
      }
      return this.inMemoryFallback.saveProjectSettings(settings);
    }
  }

  async clearProject(projectId: string): Promise<void> {
    return this.inMemoryFallback.clearProject(projectId);
  }
}

// Default driver instance
let activeDriver: IMemoryDriver = new IndexedDBMemoryDriver();

export function getMemoryDriver(): IMemoryDriver {
  return activeDriver;
}

export function setMemoryDriver(driver: IMemoryDriver): void {
  activeDriver = driver;
}
