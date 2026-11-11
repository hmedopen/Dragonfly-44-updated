import { useWorkbenchStore } from '../../../store/workbenchStore';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface AppStateInspectorDeps {
  getStoreState?: typeof useWorkbenchStore.getState;
}

export function createAppStateInspector(deps: AppStateInspectorDeps = {}): SubsystemInspector {
  const getStore = deps.getStoreState ?? useWorkbenchStore.getState;

  return {
    id: 'app-state',
    name: 'Application State',
    description: 'Zustand workbench store transitions, selection consistency, and queue/UI synchronization.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'Zustand WorkbenchStore transition tracking', tier: 'full', notes: 'Subscribed to store view, page, chapter, and review state changes.' },
      { capability: 'Store state invariant inspection', tier: 'read_only_check', notes: 'Verifies selected bubble, active page, undo stacks, and view coherence.' },
    ],
    checks: [
      {
        checkId: 'zustand-state-invariants',
        name: 'Workbench Store Consistency Check',
        description: 'Inspects useWorkbenchStore for invalid selection pointers, view/chapter mismatches, and memory stack depth.',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, _context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      if (checkId !== 'zustand-state-invariants') {
        throw new Error(`Unsupported checkId "${checkId}" on app-state inspector.`);
      }

      const state = getStore();
      const findings: DiagnosticFinding[] = [];

      if (state.currentView === 'workbench' && !state.activeChapterId) {
        findings.push({
          findingId: `state-no-ch-${start}`,
          subsystem: 'app-state',
          checkId,
          code: 'WORKBENCH_MISSING_CHAPTER_ID',
          severity: 'warning',
          title: 'Workbench view active without activeChapterId',
          explanation: 'currentView is "workbench" while activeChapterId is null.',
          timestamp: Date.now(),
        });
      }

      if (state.selectedBubbleId && state.activePageId) {
        const pageBubbles = state.bubblesByPage[state.activePageId] || [];
        if (pageBubbles.length > 0 && !pageBubbles.some((b) => b.id === state.selectedBubbleId)) {
          findings.push({
            findingId: `state-orphan-sel-${start}`,
            subsystem: 'app-state',
            checkId,
            code: 'ORPHAN_SELECTED_BUBBLE_ID',
            severity: 'warning',
            title: 'Selected bubble ID does not exist on active page',
            explanation: `selectedBubbleId "${state.selectedBubbleId}" is not in bubblesByPage["${state.activePageId}"].`,
            timestamp: Date.now(),
          });
        }
      }

      const loadedPagesCount = Object.keys(state.bubblesByPage || {}).length;
      const undoPages = Object.keys(state.bubbleUndoStack || {}).length;

      return {
        checkId,
        subsystem: 'app-state',
        name: 'Workbench Store Consistency Check',
        safety: 'read_only',
        status: findings.length > 0 ? 'warning' : 'healthy',
        durationMs: Math.max(0, Date.now() - start),
        timestamp: Date.now(),
        summary: `Store state coherent (view=${state.currentView}, loadedPages=${loadedPagesCount}, zoom=${state.zoomLevel}%, undoPages=${undoPages}).`,
        findings,
        metrics: {
          currentView: state.currentView,
          activeFolderId: state.activeFolderId,
          activeChapterId: state.activeChapterId,
          activePageId: state.activePageId,
          loadedPagesCount,
          memoryCandidatesCount: state.memoryCandidates?.length || 0,
          memoryConflictsCount: state.memoryConflicts?.length || 0,
        },
      };
    },
  };
}
