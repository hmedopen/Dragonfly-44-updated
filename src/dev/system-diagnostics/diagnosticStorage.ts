import type {
  DiagnosticEvent,
  DiagnosticSessionMetadata,
  DiagnosticSessionRecord,
  SubsystemHealthSnapshot,
} from './types';

const DIAG_DB_NAME = 'folio_dev_diagnostics_db';
const DIAG_DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_CHUNKS = 'session_chunks';
const STORE_CHECKPOINT = 'active_checkpoint';
const DEFAULT_MAX_SESSIONS = 10;

export interface SessionChunkRecord {
  chunkId: string;
  sessionId: string;
  seqStart: number;
  seqEnd: number;
  events: DiagnosticEvent[];
}

export interface ActiveSessionCheckpoint {
  id: 'current';
  metadata: DiagnosticSessionMetadata;
  systemSnapshots: SubsystemHealthSnapshot[];
  updatedAt: number;
}

export interface IDiagnosticStorageDriver {
  saveSession(record: DiagnosticSessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<DiagnosticSessionRecord | null>;
  listSessions(): Promise<DiagnosticSessionMetadata[]>;
  deleteSession(sessionId: string): Promise<void>;
  clearAllSessions(): Promise<void>;
  saveChunk(chunk: SessionChunkRecord): Promise<void>;
  getSessionChunks(sessionId: string): Promise<SessionChunkRecord[]>;
  saveCheckpoint(checkpoint: ActiveSessionCheckpoint): Promise<void>;
  getCheckpoint(): Promise<ActiveSessionCheckpoint | null>;
  clearCheckpoint(): Promise<void>;
  enforceRetention(maxSessions?: number): Promise<number>;
}

export class InMemoryDiagnosticStorageDriver implements IDiagnosticStorageDriver {
  private sessions = new Map<string, DiagnosticSessionRecord>();
  private chunks = new Map<string, SessionChunkRecord[]>();
  private checkpoint: ActiveSessionCheckpoint | null = null;
  public simulateFailure = false;

  private maybeThrow(): void {
    if (this.simulateFailure) {
      throw new Error('Simulated diagnostic storage write failure.');
    }
  }

  async saveSession(record: DiagnosticSessionRecord): Promise<void> {
    this.maybeThrow();
    this.sessions.set(record.metadata.sessionId, structuredClone(record));
    await this.enforceRetention(DEFAULT_MAX_SESSIONS);
  }

  async getSession(sessionId: string): Promise<DiagnosticSessionRecord | null> {
    const found = this.sessions.get(sessionId);
    if (!found) return null;
    return structuredClone(found);
  }

  async listSessions(): Promise<DiagnosticSessionMetadata[]> {
    return Array.from(this.sessions.values())
      .map((s) => structuredClone(s.metadata))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.chunks.delete(sessionId);
  }

  async clearAllSessions(): Promise<void> {
    this.sessions.clear();
    this.chunks.clear();
  }

  async saveChunk(chunk: SessionChunkRecord): Promise<void> {
    this.maybeThrow();
    const list = this.chunks.get(chunk.sessionId) || [];
    list.push(structuredClone(chunk));
    this.chunks.set(chunk.sessionId, list);
  }

  async getSessionChunks(sessionId: string): Promise<SessionChunkRecord[]> {
    return structuredClone(this.chunks.get(sessionId) || []);
  }

  async saveCheckpoint(checkpoint: ActiveSessionCheckpoint): Promise<void> {
    this.maybeThrow();
    this.checkpoint = structuredClone(checkpoint);
  }

  async getCheckpoint(): Promise<ActiveSessionCheckpoint | null> {
    return this.checkpoint ? structuredClone(this.checkpoint) : null;
  }

  async clearCheckpoint(): Promise<void> {
    this.checkpoint = null;
  }

  async enforceRetention(maxSessions = DEFAULT_MAX_SESSIONS): Promise<number> {
    const ordered = Array.from(this.sessions.values()).sort(
      (a, b) => b.metadata.startedAt - a.metadata.startedAt
    );
    let deleted = 0;
    for (let i = maxSessions; i < ordered.length; i++) {
      const targetId = ordered[i].metadata.sessionId;
      this.sessions.delete(targetId);
      this.chunks.delete(targetId);
      deleted++;
    }
    return deleted;
  }
}

export class IndexedDbDiagnosticStorageDriver implements IDiagnosticStorageDriver {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly maxSessions: number;

  constructor(maxSessions = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = Math.max(1, maxSessions);
  }

  private getDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB is unavailable in this environment.'));
    }
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DIAG_DB_NAME, DIAG_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'metadata.sessionId' });
          store.createIndex('startedAt', 'metadata.startedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'chunkId' });
          chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_CHECKPOINT)) {
          db.createObjectStore(STORE_CHECKPOINT, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error || new Error('Failed to open folio_dev_diagnostics_db.'));
      };
    });

    return this.dbPromise;
  }

  async saveSession(record: DiagnosticSessionRecord): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Aborted saving diagnostic session.'));
    });
    await this.enforceRetention(this.maxSessions);
  }

  async getSession(sessionId: string): Promise<DiagnosticSessionRecord | null> {
    const db = await this.getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(sessionId);
      req.onsuccess = () => resolve((req.result as DiagnosticSessionRecord) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async listSessions(): Promise<DiagnosticSessionMetadata[]> {
    const db = await this.getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).getAll();
      req.onsuccess = () => {
        const list = ((req.result as DiagnosticSessionRecord[]) || [])
          .map((r) => r.metadata)
          .sort((a, b) => b.startedAt - a.startedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    const db = await this.getDb();
    const chunks = await this.getSessionChunks(sessionId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).delete(sessionId);
      const chunkStore = tx.objectStore(STORE_CHUNKS);
      for (const ch of chunks) {
        chunkStore.delete(ch.chunkId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAllSessions(): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS, STORE_CHECKPOINT], 'readwrite');
      tx.objectStore(STORE_SESSIONS).clear();
      tx.objectStore(STORE_CHUNKS).clear();
      tx.objectStore(STORE_CHECKPOINT).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveChunk(chunk: SessionChunkRecord): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      tx.objectStore(STORE_CHUNKS).put(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSessionChunks(sessionId: string): Promise<SessionChunkRecord[]> {
    const db = await this.getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const idx = tx.objectStore(STORE_CHUNKS).index('sessionId');
      const req = idx.getAll(sessionId);
      req.onsuccess = () => {
        const res = ((req.result as SessionChunkRecord[]) || []).sort(
          (a, b) => a.seqStart - b.seqStart
        );
        resolve(res);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async saveCheckpoint(checkpoint: ActiveSessionCheckpoint): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHECKPOINT, 'readwrite');
      tx.objectStore(STORE_CHECKPOINT).put(checkpoint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCheckpoint(): Promise<ActiveSessionCheckpoint | null> {
    const db = await this.getDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHECKPOINT, 'readonly');
      const req = tx.objectStore(STORE_CHECKPOINT).get('current');
      req.onsuccess = () => resolve((req.result as ActiveSessionCheckpoint) || null);
      req.onerror = () => reject(req.error);
    });
  }

  async clearCheckpoint(): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CHECKPOINT, 'readwrite');
      tx.objectStore(STORE_CHECKPOINT).delete('current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async enforceRetention(maxSessions = this.maxSessions): Promise<number> {
    const metas = await this.listSessions();
    if (metas.length <= maxSessions) return 0;
    let deleted = 0;
    for (let i = maxSessions; i < metas.length; i++) {
      await this.deleteSession(metas[i].sessionId);
      deleted++;
    }
    return deleted;
  }
}

export function createDefaultDiagnosticStorageDriver(): IDiagnosticStorageDriver {
  if (typeof indexedDB !== 'undefined') {
    return new IndexedDbDiagnosticStorageDriver(DEFAULT_MAX_SESSIONS);
  }
  return new InMemoryDiagnosticStorageDriver();
}
