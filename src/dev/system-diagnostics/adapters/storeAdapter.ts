import { useWorkbenchStore } from '../../../store/workbenchStore';
import { settingsService } from '../../../services/settings/settingsService';
import { scanQueue } from '../../../lib/scanQueue';
import { trainingDiagnostics } from '../../../lib/training/trainingDiagnostics';
import type { DiagnosticEngine } from '../diagnosticEngine';

export function attachStoreAndServiceAdapters(engine: DiagnosticEngine): () => void {
  const unsubscribers: Array<() => void> = [];

  // 1. Zustand WorkbenchStore state transitions (read-only observer)
  try {
    let prev = useWorkbenchStore.getState();
    const unsubStore = useWorkbenchStore.subscribe((next) => {
      try {
        if (next.currentView !== prev.currentView) {
          engine.emit({
            subsystem: 'app-state',
            component: 'WorkbenchStore',
            operation: 'viewTransition',
            eventType: 'state_transition',
            severity: 'info',
            status: 'succeeded',
            identifiers: {
              projectId: next.activeFolderId || undefined,
              chapterId: next.activeChapterId || undefined,
              pageId: next.activePageId || undefined,
            },
            payload: { from: prev.currentView, to: next.currentView },
            explanation: `Navigation switched from "${prev.currentView}" to "${next.currentView}".`,
          });
        }

        if (next.activePageId !== prev.activePageId && next.activePageId) {
          engine.emit({
            subsystem: 'app-state',
            component: 'WorkbenchStore',
            operation: 'selectPage',
            eventType: 'state_transition',
            severity: 'info',
            status: 'succeeded',
            identifiers: {
              chapterId: next.activeChapterId || undefined,
              pageId: next.activePageId,
            },
            payload: { previousPageId: prev.activePageId, nextPageId: next.activePageId },
            explanation: `Active page changed to ${next.activePageId}.`,
          });
        }

        if (next.activeChapterId !== prev.activeChapterId && next.activeChapterId) {
          engine.emit({
            subsystem: 'app-state',
            component: 'WorkbenchStore',
            operation: 'openChapter',
            eventType: 'state_transition',
            severity: 'info',
            status: 'succeeded',
            identifiers: {
              projectId: next.activeFolderId || undefined,
              chapterId: next.activeChapterId,
            },
            payload: { previousChapterId: prev.activeChapterId, nextChapterId: next.activeChapterId },
            explanation: `Active chapter changed to ${next.activeChapterId}.`,
          });
        }

        if (
          next.isReviewingChapter !== prev.isReviewingChapter ||
          next.isReviewingSinglePage !== prev.isReviewingSinglePage
        ) {
          const active = next.isReviewingChapter || next.isReviewingSinglePage;
          engine.emit({
            subsystem: 'app-state',
            component: 'WorkbenchStore',
            operation: next.isReviewingChapter ? 'reviewChapterState' : 'reviewPageState',
            eventType: 'state_transition',
            severity: 'info',
            status: active ? 'running' : 'succeeded',
            identifiers: { chapterId: next.activeChapterId || undefined, pageId: next.activePageId || undefined },
            payload: {
              isReviewingChapter: next.isReviewingChapter,
              isReviewingSinglePage: next.isReviewingSinglePage,
            },
            explanation: active
              ? 'Review workflow transitioned to active running state.'
              : 'Review workflow returned to idle state.',
          });
        }

        prev = next;
      } catch {
        // Isolate subscriber error
      }
    });
    unsubscribers.push(unsubStore);
  } catch {
    // Store unavailable
  }

  // 2. SettingsService changes (with API key redaction)
  try {
    const unsubSettings = settingsService.subscribe((evt) => {
      const isSecret = evt.setting_id.toLowerCase().includes('api_key');
      engine.emit({
        subsystem: 'settings-config',
        component: 'SettingsService',
        operation: 'updateSetting',
        eventType: 'state_transition',
        severity: 'info',
        status: 'succeeded',
        identifiers: { settingId: evt.setting_id },
        payload: {
          settingId: evt.setting_id,
          scope: evt.scope,
          applyMode: evt.apply_mode,
          applied: evt.applied,
          oldValue: isSecret ? '[REDACTED]' : evt.old_value,
          newValue: isSecret ? '[REDACTED]' : evt.new_value,
          reason: evt.reason,
        },
        explanation: `Setting "${evt.setting_id}" updated at ${evt.scope} scope (${evt.applied ? 'applied immediately' : evt.reason || 'pending next operation'}).`,
      });
    });
    unsubscribers.push(unsubSettings);
  } catch {
    // Settings unavailable
  }

  // 3. ScanQueue status snapshots (observe without mutating)
  try {
    let lastOpId: string | undefined;
    let lastScanning = false;
    let lastCompleted = 0;

    const unsubQueue = scanQueue.subscribe((progress) => {
      try {
        const opChanged = progress.operationId && progress.operationId !== lastOpId;
        const scanningChanged = progress.isScanning !== lastScanning;
        const completedChanged = progress.completedCount !== lastCompleted;

        if (opChanged || scanningChanged || completedChanged) {
          const errorEntries = Object.entries(progress.pageErrors || {});
          engine.emit({
            subsystem: 'scanning-ocr',
            component: 'ScanQueueManager',
            operation: 'queueProgress',
            eventType: 'state_transition',
            severity: errorEntries.length > 0 ? 'warning' : 'info',
            status: progress.isScanning
              ? 'running'
              : errorEntries.length > 0
              ? 'degraded'
              : 'succeeded',
            correlationId: progress.operationId,
            payload: {
              activeCount: progress.activeCount,
              completedCount: progress.completedCount,
              totalCount: progress.totalCount,
              currentPageIndex: progress.currentPageIndex,
              partialPageCount: progress.partialPageIds?.length || 0,
              errorCount: errorEntries.length,
            },
            explanation: progress.isScanning
              ? `Scan queue running (${progress.completedCount}/${progress.totalCount} pages completed${progress.currentPageIndex ? `, processing page ${progress.currentPageIndex}` : ''}).`
              : `Scan queue idle (${progress.completedCount}/${progress.totalCount} completed, ${errorEntries.length} page error(s), ${progress.partialPageIds?.length || 0} partial).`,
          });
        }

        lastOpId = progress.operationId;
        lastScanning = progress.isScanning;
        lastCompleted = progress.completedCount;
      } catch {
        // Isolate
      }
    });
    unsubscribers.push(unsubQueue);
  } catch {
    // ScanQueue unavailable
  }

  // 4. Training Studio Gemini Dispatch Telemetry (dev-only)
  try {
    let seenIds = new Set<string>(trainingDiagnostics.getHistory().map((r) => r.id));
    const unsubTraining = trainingDiagnostics.subscribe((records) => {
      for (const rec of records) {
        if (seenIds.has(rec.id)) continue;
        seenIds.add(rec.id);
        engine.emit({
          subsystem: 'ai-services',
          component: 'TrainingPromptInjection',
          operation: `trainingDispatch:${rec.taskType}`,
          eventType: 'io',
          severity: 'info',
          status: 'succeeded',
          identifiers: {
            modelId: rec.model,
            taskId: rec.taskId,
          },
          payload: {
            taskType: rec.taskType,
            appliedSets: rec.appliedReferenceSets.map((s) => s.title),
            exampleCount: rec.selectedExamples.length,
            estimatedTokens: rec.contextBudgetTokensEstimate,
          },
          explanation: `Training Studio injected ${rec.appliedReferenceSets.length} reference set(s) and ${rec.selectedExamples.length} example(s) for task "${rec.taskType}" (~${Math.round(rec.contextBudgetTokensEstimate)} tokens).`,
        });
      }
    });
    unsubscribers.push(unsubTraining);
  } catch {
    // Training diagnostics unavailable
  }

  return () => {
    for (const unsub of unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore
      }
    }
  };
}
