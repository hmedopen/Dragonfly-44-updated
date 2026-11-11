import type { DiagnosticEngine } from '../diagnosticEngine';

export function attachRuntimeErrorAdapters(engine: DiagnosticEngine): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onWindowError = (event: ErrorEvent) => {
    engine.emit({
      subsystem: 'app-core',
      component: 'WindowGlobalError',
      operation: 'uncaughtError',
      eventType: 'error',
      severity: 'error',
      status: 'failed',
      payload: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      explanation: `Uncaught runtime error: ${event.message || 'Unknown error'} (${event.filename || 'unknown file'}:${event.lineno || 0}).`,
      error: event.error || new Error(event.message || 'Uncaught window error'),
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled promise rejection');
    engine.emit({
      subsystem: 'app-core',
      component: 'UnhandledPromiseRejection',
      operation: 'unhandledRejection',
      eventType: 'error',
      severity: 'error',
      status: 'failed',
      explanation: `Unhandled asynchronous promise rejection: ${msg}.`,
      error: reason,
    });
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
