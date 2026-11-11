import { validateCanonicalBox, verifyTransformRoundTrip } from '../../../lib/workspace/geometryService';
import { renderGenerationManager } from '../../../lib/workspace/renderGeneration';
import { useWorkbenchStore } from '../../../store/workbenchStore';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface RenderingUiInspectorDeps {
  getStoreState?: typeof useWorkbenchStore.getState;
  getRenderGeneration?: () => ReturnType<typeof renderGenerationManager.getActiveToken>;
  getStaleRejections?: () => number;
}

export function createRenderingUiInspector(deps: RenderingUiInspectorDeps = {}): SubsystemInspector {
  const getStore = deps.getStoreState ?? useWorkbenchStore.getState;
  const getToken = deps.getRenderGeneration ?? (() => renderGenerationManager.getActiveToken());
  const getStaleCount = deps.getStaleRejections ?? (() => renderGenerationManager.getStaleRejectionsCount());

  return {
    id: 'rendering-ui',
    name: 'Rendering & UI',
    description: 'Canvas coordinate transforms, bounding box validity, render generation guards, and UI errors.',
    coverageLevel: 'partial',
    capabilities: [
      { capability: 'Coordinate transform round-trip verification', tier: 'read_only_check', notes: 'Exercises verifyTransformRoundTrip across representative zoom/pan transforms.' },
      { capability: 'Bounding box geometry validation', tier: 'read_only_check', notes: 'Runs validateCanonicalBox on loaded page bubbles.' },
      { capability: 'Canvas image/render boundary & React ErrorBoundary', tier: 'partial', notes: 'Captures image load errors, clamping warnings, and dev ErrorBoundary catches.' },
    ],
    checks: [
      {
        checkId: 'coordinate-transform-invariants',
        name: 'Canvas Coordinate Round-Trip Invariants',
        description: 'Verifies source -> screen -> source coordinate transforms remain within 0.5 normalized unit tolerance.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'active-page-box-geometry',
        name: 'Active Page Bounding Box Geometry',
        description: 'Validates all bounding boxes on the active page for NaN, inverted coordinates, or out-of-bounds values.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];
      const store = getStore();

      if (checkId === 'coordinate-transform-invariants') {
        const testZooms = [50, 100, store.zoomLevel || 100, 300, 800];
        const testPoints = [
          { x: 0, y: 0 },
          { x: 250, y: 400 },
          { x: 500, y: 500 },
          { x: 999, y: 999 },
        ];
        let maxDrift = 0;

        for (const zoom of testZooms) {
          for (const pt of testPoints) {
            const check = verifyTransformRoundTrip(pt, {
              sourceDimensions: { width: 1000, height: 1000 },
              viewportDimensions: { width: 640, height: 840 },
              zoom,
              pan: { x: 24, y: -18 },
            });
            if (check.drift > maxDrift) maxDrift = check.drift;
            if (!check.pass) {
              findings.push({
                findingId: `render-drift-${zoom}-${pt.x}-${pt.y}`,
                subsystem: 'rendering-ui',
                checkId,
                code: 'COORDINATE_ROUNDTRIP_DRIFT',
                severity: 'error',
                title: `Coordinate transform drift ${check.drift.toFixed(3)} exceeds 0.5`,
                explanation: `At zoom=${zoom}%, point (${pt.x},${pt.y}) drifted by ${check.drift.toFixed(3)}.`,
                timestamp: Date.now(),
              });
            }
          }
        }

        const activeToken = getToken();
        const staleCount = getStaleCount();

        return {
          checkId,
          subsystem: 'rendering-ui',
          name: 'Canvas Coordinate Round-Trip Invariants',
          safety: 'read_only',
          status: findings.length > 0 ? 'error' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Transform round-trip passed across ${testZooms.length * testPoints.length} probes (max drift=${maxDrift.toFixed(4)}, stale rejections=${staleCount}).`,
          findings,
          metrics: {
            maxDrift: Number(maxDrift.toFixed(4)),
            activeGeneration: activeToken?.generation ?? null,
            staleRejectionsCount: staleCount,
          },
        };
      }

      if (checkId === 'active-page-box-geometry') {
        const pageId = context.activePageId ?? store.activePageId;
        if (!pageId) {
          return {
            checkId,
            subsystem: 'rendering-ui',
            name: 'Active Page Bounding Box Geometry',
            safety: 'read_only',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'No active page selected; open a chapter page to validate bounding boxes.',
            findings: [],
          };
        }

        const bubbles = store.bubblesByPage[pageId] || [];
        let invalidCount = 0;
        for (const b of bubbles) {
          const res = validateCanonicalBox(b.box_2d);
          if (!res.valid) {
            invalidCount++;
            findings.push({
              findingId: `render-box-${b.id}`,
              subsystem: 'rendering-ui',
              checkId,
              code: 'INVALID_CANONICAL_BOX',
              severity: 'warning',
              title: `Bubble #${b.index} (${b.id}) has invalid bounding box`,
              explanation: res.errors.join('; '),
              evidence: { pageId, bubbleId: b.id, box_2d: b.box_2d },
              timestamp: Date.now(),
            });
          }
        }

        return {
          checkId,
          subsystem: 'rendering-ui',
          name: 'Active Page Bounding Box Geometry',
          safety: 'read_only',
          status: invalidCount > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Validated ${bubbles.length} bubble bounding box(es) on page ${pageId} (${invalidCount} invalid).`,
          findings,
          metrics: { pageId, bubbleCount: bubbles.length, invalidCount },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on rendering-ui inspector.`);
    },
  };
}
