/**
 * Minimal, zero-dependency passive execution-boundary tap for development diagnostics.
 * Short-circuits immediately in production builds without importing any diagnostic modules.
 */

export type DiagnosticTapSeverity = 'healthy' | 'info' | 'warning' | 'error' | 'critical';

export type DiagnosticTapEventType =
  | 'lifecycle'
  | 'decision'
  | 'io'
  | 'state_transition'
  | 'error'
  | 'metric'
  | 'check';

export type DiagnosticTapStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'degraded'
  | 'cancelled'
  | 'skipped'
  | 'not_checked'
  | 'unsupported';

export interface DiagnosticTapEvent {
  subsystem: string;
  component: string;
  operation: string;
  eventType: DiagnosticTapEventType;
  severity: DiagnosticTapSeverity;
  status: DiagnosticTapStatus;
  durationMs?: number;
  correlationId?: string;
  parentEventId?: string;
  identifiers?: {
    projectId?: string;
    chapterId?: string;
    pageId?: string;
    pageIndex?: number;
    bubbleId?: string;
    jobId?: string;
    modelId?: string;
    routeId?: string;
    settingId?: string;
    [key: string]: string | number | boolean | undefined;
  };
  payload?: Record<string, unknown>;
  explanation: string;
  error?: unknown;
  timestamp?: number;
}

export type DiagnosticTapListener = (event: DiagnosticTapEvent) => void;

const GLOBAL_TAP_KEY = '__FOLIO_DIAGNOSTIC_TAP_LISTENER__';

/**
 * Returns true when running in a local development environment:
 * - Vite dev server (import.meta.env.DEV)
 * - Unpacked Electron dev runtime (window.folioScript.isDev === true)
 * - Localhost HTTP workspace launcher (e.g. server.cjs / Folio Script.exe on 127.0.0.1)
 * Explicitly returns false inside packaged Electron builds (folioScript.isDev === false)
 * and deployed remote web hosts.
 */
export function isSystemDiagnosticsEnabled(): boolean {
  const metaEnv =
    typeof import.meta !== 'undefined'
      ? (import.meta as { env?: { DEV?: boolean; PROD?: boolean } }).env
      : undefined;
  if (metaEnv?.DEV) {
    return true;
  }

  if (typeof window !== 'undefined') {
    const win = window as unknown as {
      folioScript?: { isDev?: boolean };
      dragonfly?: { isDev?: boolean };
      location?: { hostname?: string; protocol?: string };
    };

    if (win.folioScript) {
      return Boolean(win.folioScript.isDev);
    }
    if (win.dragonfly && typeof win.dragonfly.isDev === 'boolean') {
      return win.dragonfly.isDev;
    }

    const protocol = win.location?.protocol;
    const host = win.location?.hostname;
    if (
      (protocol === 'http:' || protocol === 'https:') &&
      (host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0')
    ) {
      return true;
    }

    return false;
  }

  if (typeof process !== 'undefined') {
    return process.env?.NODE_ENV !== 'production';
  }

  return false;
}

/**
 * Registers the active development diagnostic listener.
 * Returns an unregister callback.
 */
export function registerDiagnosticTapListener(listener: DiagnosticTapListener): () => void {
  if (!isSystemDiagnosticsEnabled()) {
    return () => {};
  }
  const g = globalThis as Record<string, unknown>;
  g[GLOBAL_TAP_KEY] = listener;
  return () => {
    if (g[GLOBAL_TAP_KEY] === listener) {
      delete g[GLOBAL_TAP_KEY];
    }
  };
}

/**
 * Emits a structured execution-boundary event when a dev listener is attached.
 * Guaranteed never to throw or alter caller control flow.
 */
export function emitDiagnosticBoundary(event: DiagnosticTapEvent): void {
  if (!isSystemDiagnosticsEnabled()) {
    return;
  }
  try {
    const g = globalThis as Record<string, unknown>;
    const listener = g[GLOBAL_TAP_KEY];
    if (typeof listener === 'function') {
      (listener as DiagnosticTapListener)(event);
    }
  } catch {
    // Diagnostics must remain strictly observational and never affect application execution.
  }
}

let corrCounter = 0;

/**
 * Creates a deterministic-prefix correlation ID for connecting async stages.
 */
export function createDiagnosticCorrelationId(prefix = 'op'): string {
  if (!isSystemDiagnosticsEnabled()) {
    return `${prefix}-disabled`;
  }
  corrCounter = (corrCounter + 1) % 1000000;
  return `${prefix}-${Date.now()}-${corrCounter}-${Math.random().toString(36).slice(2, 6)}`;
}
