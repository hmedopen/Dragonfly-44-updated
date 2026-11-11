import { resolveOcrLanguageRoute } from '../../../lib/localOcr/languageRouter';
import { scanQueue } from '../../../lib/scanQueue';
import { getPageScan } from '../../../services/db';
import { settingsService } from '../../../services/settings/settingsService';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface ScanningOcrInspectorDeps {
  getPageScan?: typeof getPageScan;
  getEffectiveSetting?: typeof settingsService.getEffectiveValue;
  getQueueState?: () => {
    errors: Record<string, string>;
    warnings: Record<string, string[]>;
    partialIds: string[];
  };
  getStoreState?: typeof useWorkbenchStore.getState;
}

export function createScanningOcrInspector(deps: ScanningOcrInspectorDeps = {}): SubsystemInspector {
  const loadPageScan = deps.getPageScan ?? getPageScan;
  const getSetting = deps.getEffectiveSetting ?? settingsService.getEffectiveValue.bind(settingsService);
  const getQueue =
    deps.getQueueState ??
    (() => ({
      errors: scanQueue.getPageErrors(),
      warnings: scanQueue.getPageWarnings(),
      partialIds: scanQueue.getPartialPageIds(),
    }));
  const getStore = deps.getStoreState ?? useWorkbenchStore.getState;

  return {
    id: 'scanning-ocr',
    name: 'Scanning & OCR',
    description: 'Scan queue, language routing, local OCR worker, hybrid reconciliation, and crop retries.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'Scan Page & Scan All queue lifecycle', tier: 'full', notes: 'Instrumented at queue & page boundaries with correlation IDs.' },
      { capability: 'Language detection & routing', tier: 'full', notes: 'Verified via live boundary events and read-only route dry-run.' },
      { capability: 'Local OCR worker & hybrid fallback', tier: 'full', notes: 'Captures timings, cache hits, fallback reasons, and candidate counts.' },
      { capability: 'Canonical PageScanResult inspection', tier: 'read_only_check', notes: 'Inspects stored IndexedDB scan records for active page.' },
    ],
    checks: [
      {
        checkId: 'scan-queue-state',
        name: 'Scan Queue & Error State',
        description: 'Inspects current queue errors, partial page warnings, and active scanning flags.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'language-route-dry-run',
        name: 'OCR Language Routing Dry-Run',
        description: 'Tests how resolveOcrLanguageRoute behaves under current settings and active page bubbles.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'active-page-scan-record',
        name: 'Active Page Canonical Scan Record',
        description: 'Reads the persisted PageScanResult in IndexedDB for the active page without modifying it.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];
      const store = getStore();

      if (checkId === 'scan-queue-state') {
        const q = getQueue();
        const errEntries = Object.entries(q.errors);
        const warnEntries = Object.entries(q.warnings);

        for (const [pageId, msg] of errEntries) {
          findings.push({
            findingId: `scan-q-err-${pageId}-${start}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'SCAN_QUEUE_PAGE_ERROR',
            severity: 'error',
            title: `Page ${pageId} scan failed`,
            explanation: msg,
            evidence: { pageId },
            timestamp: Date.now(),
          });
        }
        for (const [pageId, warnList] of warnEntries) {
          findings.push({
            findingId: `scan-q-warn-${pageId}-${start}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'SCAN_QUEUE_PARTIAL_WARNING',
            severity: 'warning',
            title: `Page ${pageId} completed partially`,
            explanation: warnList.join(' | '),
            evidence: { pageId, warnings: warnList },
            timestamp: Date.now(),
          });
        }

        const stuckPages = Object.entries(store.pageStatuses || {}).filter(
          ([, st]) => st === 'scanning'
        );
        if (stuckPages.length > 0 && !store.isScanningActive && !store.isScanningSinglePage) {
          findings.push({
            findingId: `scan-stuck-${start}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'STALE_SCANNING_STATUS',
            severity: 'warning',
            title: 'Page status shows scanning while queue is idle',
            explanation: `${stuckPages.length} page(s) still carry "scanning" status while store scanning flags are false.`,
            evidence: { pageIds: stuckPages.map(([id]) => id) },
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'scanning-ocr',
          name: 'Scan Queue & Error State',
          safety: 'read_only',
          status: errEntries.length > 0 ? 'error' : findings.length > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary:
            errEntries.length === 0 && findings.length === 0
              ? `Scan queue healthy (activeScan=${store.isScanningActive || store.isScanningSinglePage}, 0 page errors, 0 partial warnings).`
              : `Scan queue reported ${errEntries.length} error(s) and ${findings.length - errEntries.length} warning(s).`,
          findings,
          metrics: {
            isScanningActive: store.isScanningActive,
            isScanningSinglePage: store.isScanningSinglePage,
            errorCount: errEntries.length,
            partialCount: q.partialIds.length,
          },
        };
      }

      if (checkId === 'language-route-dry-run') {
        const projectId = context.activeProjectId ?? store.activeFolderId;
        const chapterId = context.activeChapterId ?? store.activeChapterId;
        const pageId = context.activePageId ?? store.activePageId;
        const hint = String(
          getSetting<string>('scanning.source_language', { projectId, chapterId }).value || 'auto'
        );
        const pageBubbles = pageId ? store.bubblesByPage[pageId] || [] : [];
        const sampleText = pageBubbles
          .filter((b) => b.type !== 'sfx' && b.typerPrefix !== 'SFX:')
          .map((b) => (b.sourceText || '').trim())
          .filter(Boolean)
          .join('\n');

        const route = resolveOcrLanguageRoute(hint, sampleText || undefined);
        if (route.status !== 'resolved') {
          findings.push({
            findingId: `scan-route-refused-${start}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'LOCAL_OCR_ROUTE_REFUSED',
            severity: 'warning',
            title: `Language routing (${hint}) will fall back to Gemini`,
            explanation: route.routingReason,
            remediation: 'Set explicit scanning.source_language (en, ko, ja, zh) in Settings if you expect local OCR on unscanned pages.',
            evidence: {
              configuredHint: hint,
              routeStatus: route.status,
              detectedScript: route.detectedScript,
            },
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'scanning-ocr',
          name: 'OCR Language Routing Dry-Run',
          safety: 'read_only',
          status: route.status === 'resolved' ? 'healthy' : 'warning',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary:
            route.status === 'resolved'
              ? `Language hint "${hint}" resolved deterministically to local route "${route.routeId}" (${route.effectiveLanguage}).`
              : `Language hint "${hint}" returned "${route.status}" — hybrid scan will safely fall back to Gemini unless sample text resolves script.`,
          findings,
          metrics: {
            configuredHint: hint,
            routeStatus: route.status,
            routeId: route.routeId,
            effectiveLanguage: route.effectiveLanguage,
            sampleLength: sampleText.length,
          },
        };
      }

      if (checkId === 'active-page-scan-record') {
        const pageId = context.activePageId ?? store.activePageId;
        if (!pageId) {
          return {
            checkId,
            subsystem: 'scanning-ocr',
            name: 'Active Page Canonical Scan Record',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'No active page is currently selected in the Workbench; open a page to inspect its scan record.',
            findings: [],
          };
        }

        if (typeof indexedDB === 'undefined') {
          return {
            checkId,
            subsystem: 'scanning-ocr',
            name: 'Active Page Canonical Scan Record',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'IndexedDB is unavailable in this environment.',
            findings: [],
          };
        }

        const scan = await loadPageScan(pageId);
        if (!scan) {
          return {
            checkId,
            subsystem: 'scanning-ocr',
            name: 'Active Page Canonical Scan Record',
            safety: 'read_only',
            status: 'warning',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: `Page ${pageId} has no persisted canonical PageScanResult in IndexedDB yet (either unscanned or legacy bubbles only).`,
            findings: [
              {
                findingId: `scan-missing-rec-${pageId}`,
                subsystem: 'scanning-ocr',
                checkId,
                code: 'NO_CANONICAL_SCAN_RECORD',
                severity: 'info',
                title: 'No stored PageScanResult for active page',
                explanation: `IndexedDB store page_scans has no entry for page ${pageId}.`,
                timestamp: Date.now(),
              },
            ],
          };
        }

        if (scan.status === 'failed') {
          findings.push({
            findingId: `scan-rec-failed-${pageId}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'PAGE_SCAN_FAILED',
            severity: 'error',
            title: 'Active page scan record marked failed',
            explanation: scan.issues.map((i) => i.reason).join('; ') || 'Scan status is failed.',
            timestamp: Date.now(),
          });
        } else if (scan.status === 'partial' || scan.issues.length > 0) {
          findings.push({
            findingId: `scan-rec-partial-${pageId}`,
            subsystem: 'scanning-ocr',
            checkId,
            code: 'PAGE_SCAN_ISSUES',
            severity: 'warning',
            title: `Active page scan has status "${scan.status}" with ${scan.issues.length} issue(s)`,
            explanation: scan.issues.map((i) => `${i.flag}: ${i.reason}`).slice(0, 4).join(' | ') || 'Partial scan completion.',
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'scanning-ocr',
          name: 'Active Page Canonical Scan Record',
          safety: 'read_only',
          status:
            scan.status === 'failed'
              ? 'error'
              : scan.status === 'partial' || scan.issues.length > 0
              ? 'warning'
              : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Active page scan (${scan.scanId}) status=${scan.status}, ${scan.regions.length} regions, ${scan.panels.length} panels, ${scan.issues.length} scan issue(s).`,
          findings,
          metrics: {
            pageId,
            scanId: scan.scanId,
            status: scan.status,
            regionCount: scan.regions.length,
            panelCount: scan.panels.length,
            issueCount: scan.issues.length,
            dimensions: scan.sourceDimensions,
          },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on scanning-ocr inspector.`);
    },
  };
}
