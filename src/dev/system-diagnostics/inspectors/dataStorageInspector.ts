import { DB_VERSION, getDatabase } from '../../../services/db';
import { getMemoryDriver } from '../../../services/memoryRepository';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

const EXPECTED_STORES = [
  'page_blobs',
  'page_bubbles',
  'page_scans',
  'project_lore',
  'chapter_intelligence',
  'projects',
  'chapters',
  'pages',
  'chapter_snapshots',
  'migration_journal',
  'review_findings',
  'review_snapshots',
  'review_audit',
  'knowledge_records',
  'knowledge_revisions',
  'knowledge_candidates',
  'knowledge_audit',
  'knowledge_quarantine',
  'knowledge_conflicts',
  'knowledge_idempotency',
  'memory_settings',
  'training_reference_sets',
  'training_blobs',
];

export interface DataStorageInspectorDeps {
  getDatabase?: typeof getDatabase;
  getMemoryDriver?: typeof getMemoryDriver;
  getStoreState?: typeof useWorkbenchStore.getState;
}

export function createDataStorageInspector(deps: DataStorageInspectorDeps = {}): SubsystemInspector {
  const openDb = deps.getDatabase ?? getDatabase;
  const getMemDriver = deps.getMemoryDriver ?? getMemoryDriver;
  const getStore = deps.getStoreState ?? useWorkbenchStore.getState;

  return {
    id: 'data-storage',
    name: 'Data & Storage',
    description: 'IndexedDB schema, object store counts, storage quota, localStorage integrity, and read-only memory checks.',
    coverageLevel: 'partial',
    capabilities: [
      { capability: 'IndexedDB schema & store inventory', tier: 'read_only_check', notes: 'Opens dragonfly44_db read-only and counts entries per store.' },
      { capability: 'Storage quota & localStorage footprint', tier: 'read_only_check', notes: 'Reads navigator.storage.estimate() and localStorage JSON validity.' },
      { capability: 'Project Memory integrity audit', tier: 'read_only_check', notes: 'Inspects records/candidates/conflicts read-only without emitting audit DB writes.' },
      { capability: 'db.ts read/write/error boundaries', tier: 'partial', notes: 'Instruments db.ts save/get operations and failures.' },
    ],
    checks: [
      {
        checkId: 'indexeddb-schema-health',
        name: 'IndexedDB Schema & Store Inventory',
        description: 'Verifies dragonfly44_db accessibility, version match, expected object stores, and non-destructive record counts.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'storage-quota-and-localstorage',
        name: 'Storage Quota & LocalStorage Consistency',
        description: 'Inspects browser storage usage estimate and verifies folder/settings localStorage payloads parse cleanly.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'memory-integrity-readonly',
        name: 'Project Memory Read-Only Integrity',
        description: 'Checks active project knowledge records for duplicate canonical keys, missing provenance, or unresolved conflicts without writing audit rows.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];

      if (checkId === 'indexeddb-schema-health') {
        if (typeof indexedDB === 'undefined') {
          return {
            checkId,
            subsystem: 'data-storage',
            name: 'IndexedDB Schema & Store Inventory',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'IndexedDB is unavailable in this Node/non-browser environment.',
            findings: [],
          };
        }

        const db = await openDb();
        const existingStores = Array.from(db.objectStoreNames);
        const missingStores = EXPECTED_STORES.filter((s) => !existingStores.includes(s));

        if (db.version !== DB_VERSION) {
          findings.push({
            findingId: `db-ver-${start}`,
            subsystem: 'data-storage',
            checkId,
            code: 'DB_VERSION_MISMATCH',
            severity: 'warning',
            title: `Database version ${db.version} differs from expected ${DB_VERSION}`,
            explanation: `Opened IndexedDB version ${db.version}, while code defines DB_VERSION=${DB_VERSION}.`,
            timestamp: Date.now(),
          });
        }
        if (missingStores.length > 0) {
          findings.push({
            findingId: `db-missing-stores-${start}`,
            subsystem: 'data-storage',
            checkId,
            code: 'MISSING_OBJECT_STORES',
            severity: 'critical',
            title: `${missingStores.length} expected object store(s) missing`,
            explanation: `Missing stores: ${missingStores.join(', ')}.`,
            timestamp: Date.now(),
          });
        }

        const counts: Record<string, number> = {};
        if (existingStores.length > 0) {
          const tx = db.transaction(existingStores, 'readonly');
          await Promise.all(
            existingStores.map(
              (storeName) =>
                new Promise<void>((resolve) => {
                  const req = tx.objectStore(storeName).count();
                  req.onsuccess = () => {
                    counts[storeName] = req.result;
                    resolve();
                  };
                  req.onerror = () => {
                    counts[storeName] = -1;
                    resolve();
                  };
                })
            )
          );
        }

        return {
          checkId,
          subsystem: 'data-storage',
          name: 'IndexedDB Schema & Store Inventory',
          safety: 'read_only',
          status: missingStores.length > 0 ? 'critical' : findings.length > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `IndexedDB "${db.name}" v${db.version} accessible with ${existingStores.length} object store(s) (${counts.page_blobs ?? 0} page blobs, ${counts.page_bubbles ?? 0} bubble pages, ${counts.page_scans ?? 0} scan records).`,
          findings,
          metrics: {
            dbName: db.name,
            version: db.version,
            storeCount: existingStores.length,
            missingStores,
            counts,
          },
        };
      }

      if (checkId === 'storage-quota-and-localstorage') {
        if (typeof window === 'undefined' || !window.localStorage) {
          return {
            checkId,
            subsystem: 'data-storage',
            name: 'Storage Quota & LocalStorage Consistency',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Browser storage APIs are unavailable in this runtime.',
            findings: [],
          };
        }

        let quotaBytes: number | null = null;
        let usageBytes: number | null = null;
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
          try {
            const est = await navigator.storage.estimate();
            quotaBytes = est.quota ?? null;
            usageBytes = est.usage ?? null;
          } catch {
            // Ignore estimate failure
          }
        }

        const jsonKeys = ['dragonfly44_folders_v5', 'dragonfly44_settings_v6', 'dragonfly44_typers_v1'];
        let totalLocalChars = 0;
        for (const key of jsonKeys) {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            totalLocalChars += raw.length;
            try {
              JSON.parse(raw);
            } catch {
              findings.push({
                findingId: `ls-corrupt-${key}-${start}`,
                subsystem: 'data-storage',
                checkId,
                code: 'CORRUPT_LOCALSTORAGE_JSON',
                severity: 'error',
                title: `Corrupted JSON in localStorage key "${key}"`,
                explanation: `Failed to parse "${key}".`,
                timestamp: Date.now(),
              });
            }
          }
        }

        const usageRatio = quotaBytes && usageBytes ? usageBytes / quotaBytes : 0;
        if (usageRatio > 0.85) {
          findings.push({
            findingId: `quota-high-${start}`,
            subsystem: 'data-storage',
            checkId,
            code: 'HIGH_STORAGE_USAGE',
            severity: 'warning',
            title: 'Browser storage usage exceeds 85% of quota',
            explanation: `Using ${Math.round((usageBytes || 0) / (1024 * 1024))} MB of ${Math.round((quotaBytes || 0) / (1024 * 1024))} MB quota.`,
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'data-storage',
          name: 'Storage Quota & LocalStorage Consistency',
          safety: 'read_only',
          status: findings.some((f) => f.severity === 'error')
            ? 'error'
            : findings.length > 0
            ? 'warning'
            : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `LocalStorage JSON payloads valid (${Math.round(totalLocalChars / 1024)} KB checked)${
            usageBytes !== null && quotaBytes !== null
              ? `; IndexedDB/origin usage ${Math.round(usageBytes / (1024 * 1024))} MB / ${Math.round(quotaBytes / (1024 * 1024))} MB`
              : ''
          }.`,
          findings,
          metrics: {
            usageBytes,
            quotaBytes,
            totalLocalChars,
          },
        };
      }

      if (checkId === 'memory-integrity-readonly') {
        const store = getStore();
        const projectId = context.activeProjectId ?? store.activeFolderId;
        if (!projectId || projectId === 'folder-drafts') {
          return {
            checkId,
            subsystem: 'data-storage',
            name: 'Project Memory Read-Only Integrity',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'No non-draft project folder is active; select a project folder to inspect Project Memory integrity.',
            findings: [],
          };
        }

        const driver = getMemDriver();
        const records = await driver.getRecordsByProject(projectId);
        const candidates = await driver.getCandidatesByProject(projectId);
        const conflicts = await driver.getConflictsByProject(projectId);

        const seenCanonical = new Set<string>();
        for (const rec of records) {
          if (rec.status === 'approved') {
            if (seenCanonical.has(rec.canonical_key)) {
              findings.push({
                findingId: `mem-dup-${rec.record_id}`,
                subsystem: 'data-storage',
                checkId,
                code: 'MEMORY_DUPLICATE_CANONICAL_KEY',
                severity: 'warning',
                title: `Duplicate approved key "${rec.canonical_key}"`,
                explanation: `Record ${rec.record_id} shares canonical key "${rec.canonical_key}" with another approved record.`,
                timestamp: Date.now(),
              });
            }
            seenCanonical.add(rec.canonical_key);

            if (rec.trust_class !== 'user_confirmed' && (!rec.provenance || rec.provenance.length === 0)) {
              findings.push({
                findingId: `mem-prov-${rec.record_id}`,
                subsystem: 'data-storage',
                checkId,
                code: 'MEMORY_MISSING_PROVENANCE',
                severity: 'error',
                title: `Approved record "${rec.canonical_key}" missing provenance`,
                explanation: `Non-user record ${rec.record_id} has no provenance source references.`,
                timestamp: Date.now(),
              });
            }
          }
        }

        const unresolvedConflicts = conflicts.filter((c) => c.status === 'unresolved');
        if (unresolvedConflicts.length > 0) {
          findings.push({
            findingId: `mem-conf-${projectId}-${start}`,
            subsystem: 'data-storage',
            checkId,
            code: 'MEMORY_UNRESOLVED_CONFLICTS',
            severity: 'warning',
            title: `${unresolvedConflicts.length} unresolved Project Memory conflict(s)`,
            explanation: `Project ${projectId} has ${unresolvedConflicts.length} conflict(s) pending resolution.`,
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'data-storage',
          name: 'Project Memory Read-Only Integrity',
          safety: 'read_only',
          status: findings.some((f) => f.severity === 'error')
            ? 'error'
            : findings.length > 0
            ? 'warning'
            : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Inspected ${records.length} knowledge record(s), ${candidates.length} candidate(s), and ${conflicts.length} conflict(s) for project ${projectId} (read-only).`,
          findings,
          metrics: {
            projectId,
            recordCount: records.length,
            candidateCount: candidates.length,
            unresolvedConflictCount: unresolvedConflicts.length,
          },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on data-storage inspector.`);
    },
  };
}
