import { settingsService } from '../../../services/settings/settingsService';
import { GEMINI_MODEL_PROFILES } from '../../../types/workbench';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface AiServicesInspectorDeps {
  getEffectiveSetting?: typeof settingsService.getEffectiveValue;
  resolveModel?: typeof settingsService.resolveEffectiveModel;
  fetchImpl?: typeof fetch;
}

export function createAiServicesInspector(deps: AiServicesInspectorDeps = {}): SubsystemInspector {
  const getSetting = deps.getEffectiveSetting ?? settingsService.getEffectiveValue.bind(settingsService);
  const resolveModel = deps.resolveModel ?? settingsService.resolveEffectiveModel.bind(settingsService);
  const fetchFn = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);

  return {
    id: 'ai-services',
    name: 'AI & External Services',
    description: 'Gemini API readiness, model profiles, latency, retries, rate limits, and dispatches.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'Gemini request/response/retry/error instrumentation', tier: 'full', notes: 'Instrumented across scan, single-bubble, batch translation, crop retry, and review.' },
      { capability: 'Training Studio dispatch ledger', tier: 'full', notes: 'Subscribed to trainingDiagnostics.' },
      { capability: 'Controlled Gemini endpoint handshake', tier: 'read_only_check', notes: 'Optional explicit ping test (controlled_test); never sends user images or prints API key.' },
    ],
    checks: [
      {
        checkId: 'gemini-config-readiness',
        name: 'Gemini Configuration Readiness',
        description: 'Checks API key presence (never prints key) and validates selected/custom model configuration.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'gemini-endpoint-ping',
        name: 'Controlled Gemini Endpoint Handshake',
        description: 'Sends a lightweight metadata GET request to the configured Gemini model endpoint to verify connectivity and latency.',
        safety: 'controlled_test',
        defaultEnabled: false,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];
      const projectId = context.activeProjectId ?? undefined;
      const chapterId = context.activeChapterId ?? undefined;

      const apiKey = String(getSetting<string>('general.gemini_api_key', { projectId, chapterId }).value || '').trim();
      const rawModel = String(getSetting<string>('translation.model', { projectId, chapterId }).value || 'gemini-3.8-flash');
      const customModel = String(getSetting<string>('translation.custom_model', { projectId, chapterId }).value || '').trim();
      const effectiveModel = resolveModel({ projectId, chapterId });

      if (checkId === 'gemini-config-readiness') {
        if (!apiKey) {
          findings.push({
            findingId: `ai-no-key-${start}`,
            subsystem: 'ai-services',
            checkId,
            code: 'MISSING_GEMINI_API_KEY',
            severity: 'warning',
            title: 'Gemini API key is not configured',
            explanation: 'Multimodal Gemini scanning, translation, and AI review stages will fail or skip until a key is set in Settings.',
            remediation: 'Configure Gemini API Key in Settings -> General.',
            timestamp: Date.now(),
          });
        }

        if (rawModel === 'custom' && !customModel) {
          findings.push({
            findingId: `ai-empty-custom-${start}`,
            subsystem: 'ai-services',
            checkId,
            code: 'EMPTY_CUSTOM_MODEL',
            severity: 'warning',
            title: 'Custom model selected with empty endpoint ID',
            explanation: `translation.model is "custom" but translation.custom_model is blank; runtime falls back to "${effectiveModel}".`,
            timestamp: Date.now(),
          });
        }

        const profileKnown = rawModel in GEMINI_MODEL_PROFILES;
        if (!profileKnown) {
          findings.push({
            findingId: `ai-unknown-model-${start}`,
            subsystem: 'ai-services',
            checkId,
            code: 'UNKNOWN_MODEL_PROFILE',
            severity: 'warning',
            title: `Unknown model key "${rawModel}"`,
            explanation: 'Model key is not listed in GEMINI_MODEL_PROFILES.',
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'ai-services',
          name: 'Gemini Configuration Readiness',
          safety: 'read_only',
          status: findings.length > 0 ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: apiKey
            ? `Gemini API key configured; effective model resolved to "${effectiveModel}".`
            : `Gemini API key missing; effective model is "${effectiveModel}".`,
          findings,
          metrics: {
            apiKeyConfigured: Boolean(apiKey),
            selectedModel: rawModel,
            effectiveModel,
          },
        };
      }

      if (checkId === 'gemini-endpoint-ping') {
        if (!apiKey) {
          return {
            checkId,
            subsystem: 'ai-services',
            name: 'Controlled Gemini Endpoint Handshake',
            safety: 'controlled_test',
            status: 'warning',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Skipped endpoint handshake because Gemini API key is not configured.',
            findings: [
              {
                findingId: `ai-ping-nokey-${start}`,
                subsystem: 'ai-services',
                checkId,
                code: 'PING_SKIPPED_NO_KEY',
                severity: 'warning',
                title: 'Cannot test Gemini endpoint without API key',
                explanation: 'Add a Gemini API key in Settings before running the live endpoint handshake.',
                timestamp: Date.now(),
              },
            ],
          };
        }
        if (!fetchFn) {
          return {
            checkId,
            subsystem: 'ai-services',
            name: 'Controlled Gemini Endpoint Handshake',
            safety: 'controlled_test',
            status: 'unsupported',
            durationMs: Math.max(0, Date.now() - start),
            timestamp: Date.now(),
            summary: 'Fetch API is unavailable in this environment.',
            findings: [],
          };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(effectiveModel)}?key=${encodeURIComponent(apiKey)}`;
        try {
          const res = await fetchFn(url);
          const latencyMs = Math.max(0, Date.now() - start);
          if (!res.ok) {
            const errJson = await res.json().catch(() => null);
            const msg = errJson?.error?.message || `HTTP ${res.status} ${res.statusText}`;
            findings.push({
              findingId: `ai-ping-fail-${start}`,
              subsystem: 'ai-services',
              checkId,
              code: `GEMINI_HTTP_${res.status}`,
              severity: res.status === 401 || res.status === 403 ? 'critical' : 'error',
              title: `Gemini endpoint rejected handshake (HTTP ${res.status})`,
              explanation: msg,
              timestamp: Date.now(),
            });
            return {
              checkId,
              subsystem: 'ai-services',
              name: 'Controlled Gemini Endpoint Handshake',
              safety: 'controlled_test',
              status: res.status === 401 || res.status === 403 ? 'critical' : 'error',
              durationMs: latencyMs,
              timestamp: Date.now(),
              summary: `Gemini handshake failed for "${effectiveModel}" (${msg}) in ${latencyMs}ms.`,
              findings,
              metrics: { httpStatus: res.status, latencyMs, effectiveModel },
            };
          }
          return {
            checkId,
            subsystem: 'ai-services',
            name: 'Controlled Gemini Endpoint Handshake',
            safety: 'controlled_test',
            status: 'healthy',
            durationMs: latencyMs,
            timestamp: Date.now(),
            summary: `Gemini endpoint "${effectiveModel}" responded HTTP 200 in ${latencyMs}ms.`,
            findings: [],
            metrics: { httpStatus: res.status, latencyMs, effectiveModel },
          };
        } catch (err) {
          const latencyMs = Math.max(0, Date.now() - start);
          const msg = err instanceof Error ? err.message : String(err);
          findings.push({
            findingId: `ai-ping-net-${start}`,
            subsystem: 'ai-services',
            checkId,
            code: 'GEMINI_NETWORK_ERROR',
            severity: 'error',
            title: 'Gemini network request failed',
            explanation: msg,
            timestamp: Date.now(),
          });
          return {
            checkId,
            subsystem: 'ai-services',
            name: 'Controlled Gemini Endpoint Handshake',
            safety: 'controlled_test',
            status: 'error',
            durationMs: latencyMs,
            timestamp: Date.now(),
            summary: `Network failure reaching Gemini API: ${msg}`,
            findings,
          };
        }
      }

      throw new Error(`Unsupported checkId "${checkId}" on ai-services inspector.`);
    },
  };
}
