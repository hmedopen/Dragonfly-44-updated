import { SETTINGS_REGISTRY } from '../../../services/settings/settingsRegistry';
import { settingsService } from '../../../services/settings/settingsService';
import { loadTyperSettings } from '../../../types/typers';
import type {
  DiagnosticCheckResult,
  DiagnosticFinding,
  InspectorContext,
  SubsystemInspector,
} from '../types';

export interface SettingsConfigInspectorDeps {
  getEffectiveValue?: typeof settingsService.getEffectiveValue;
  isPending?: typeof settingsService.isPending;
  getRevision?: typeof settingsService.getRevision;
  loadTypers?: typeof loadTyperSettings;
}

export function createSettingsConfigInspector(deps: SettingsConfigInspectorDeps = {}): SubsystemInspector {
  const getEffective = deps.getEffectiveValue ?? settingsService.getEffectiveValue.bind(settingsService);
  const checkPending = deps.isPending ?? settingsService.isPending.bind(settingsService);
  const getRev = deps.getRevision ?? settingsService.getRevision.bind(settingsService);
  const getTypers = deps.loadTypers ?? loadTyperSettings;

  return {
    id: 'settings-config',
    name: 'Settings & Configuration',
    description: 'Registry validation, persistence health, LKG fallback, typer definitions, and runtime mismatches.',
    coverageLevel: 'full',
    capabilities: [
      { capability: 'All SETTINGS_REGISTRY typed validation', tier: 'read_only_check', notes: 'Audits every setting ID against its schema validator.' },
      { capability: 'Runtime configuration mismatch detection', tier: 'read_only_check', notes: 'Flags effective overrides and potential auto-route/model/review conflicts.' },
      { capability: 'Live settings change stream', tier: 'full', notes: 'Subscribed to settingsService with secret redaction.' },
    ],
    checks: [
      {
        checkId: 'settings-registry-and-persistence',
        name: 'Settings Registry & Persistence Audit',
        description: 'Validates every registered setting value, localStorage v6/LKG backups, and typer settings.',
        safety: 'read_only',
        defaultEnabled: true,
      },
      {
        checkId: 'runtime-configuration-mismatches',
        name: 'Runtime Configuration Mismatch Check',
        description: 'Detects settings combinations that alter runtime behavior (e.g., auto language routing, empty custom model, safety overrides).',
        safety: 'read_only',
        defaultEnabled: true,
      },
    ],
    async runCheck(checkId: string, context: InspectorContext): Promise<DiagnosticCheckResult> {
      const start = Date.now();
      const findings: DiagnosticFinding[] = [];
      const projectId = context.activeProjectId ?? undefined;
      const chapterId = context.activeChapterId ?? undefined;

      if (checkId === 'settings-registry-and-persistence') {
        const keys = Object.keys(SETTINGS_REGISTRY);
        const pendingKeys: string[] = [];
        let invalidCount = 0;

        for (const id of keys) {
          const def = SETTINGS_REGISTRY[id];
          const resolved = getEffective(id, { projectId, chapterId });
          if (checkPending(id)) pendingKeys.push(id);

          if (def.validation) {
            const check = def.validation(resolved.value);
            if (!check.valid) {
              invalidCount++;
              findings.push({
                findingId: `cfg-inv-${id}`,
                subsystem: 'settings-config',
                checkId,
                code: 'INVALID_SETTING_VALUE',
                severity: 'error',
                title: `Setting "${id}" failed validation`,
                explanation: check.error || 'Validation failed.',
                timestamp: Date.now(),
              });
            }
          }
        }

        if (typeof window !== 'undefined' && window.localStorage) {
          const v6 = window.localStorage.getItem('dragonfly44_settings_v6');
          const lkg = window.localStorage.getItem('dragonfly44_settings_lkg_v6');
          if (v6) {
            try {
              JSON.parse(v6);
            } catch {
              findings.push({
                findingId: `cfg-v6-corrupt-${start}`,
                subsystem: 'settings-config',
                checkId,
                code: 'CORRUPT_SETTINGS_V6',
                severity: 'error',
                title: 'dragonfly44_settings_v6 contains invalid JSON',
                explanation: 'Primary settings payload failed JSON.parse.',
                timestamp: Date.now(),
              });
            }
          }
          if (!lkg && v6) {
            findings.push({
              findingId: `cfg-lkg-missing-${start}`,
              subsystem: 'settings-config',
              checkId,
              code: 'MISSING_LKG_BACKUP',
              severity: 'warning',
              title: 'Last-Known-Good settings backup is missing',
              explanation: 'dragonfly44_settings_lkg_v6 has not been written alongside primary settings.',
              timestamp: Date.now(),
            });
          }
        }

        const typers = getTypers();
        if (!typers.typers || typers.typers.length === 0) {
          findings.push({
            findingId: `cfg-no-typers-${start}`,
            subsystem: 'settings-config',
            checkId,
            code: 'EMPTY_TYPER_CONFIG',
            severity: 'warning',
            title: 'No typer classifications configured',
            explanation: 'loadTyperSettings() returned zero typers.',
            timestamp: Date.now(),
          });
        }

        return {
          checkId,
          subsystem: 'settings-config',
          name: 'Settings Registry & Persistence Audit',
          safety: 'read_only',
          status: findings.some((f) => f.severity === 'error')
            ? 'error'
            : findings.length > 0
            ? 'warning'
            : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Verified ${keys.length} registered settings (revision r${getRev()}, ${invalidCount} invalid, ${pendingKeys.length} pending next operation, ${typers.typers.length} typers).`,
          findings,
          metrics: {
            registeredCount: keys.length,
            revision: getRev(),
            invalidCount,
            pendingCount: pendingKeys.length,
            typersCount: typers.typers.length,
          },
        };
      }

      if (checkId === 'runtime-configuration-mismatches') {
        const sourceLang = getEffective<string>('scanning.source_language', { projectId, chapterId }).value;
        const model = getEffective<string>('translation.model', { projectId, chapterId }).value;
        const customModel = getEffective<string>('translation.custom_model', { projectId, chapterId }).value;
        const reviewProfile = getEffective<string>('review.profile', { projectId, chapterId }).value;
        const autoCorrect = getEffective<boolean>('review.auto_correction_eligibility', { projectId, chapterId });
        const scanProfile = getEffective<string>('scanning.profile', { projectId, chapterId }).value;
        const cropRetries = getEffective<boolean>('scanning.enable_crop_retries', { projectId, chapterId }).value;

        if (sourceLang === 'auto') {
          findings.push({
            findingId: `cfg-auto-lang-${start}`,
            subsystem: 'settings-config',
            checkId,
            code: 'AUTO_SOURCE_LANGUAGE_ACTIVE',
            severity: 'info',
            title: 'Source language is set to "auto"',
            explanation: 'New unscanned pages have no prior script sample, so hybrid scanning will route to Gemini full scan instead of local OCR unless an explicit language (en/ko/ja/zh) is set.',
            timestamp: Date.now(),
          });
        }
        if (model === 'custom' && (!customModel || !String(customModel).trim())) {
          findings.push({
            findingId: `cfg-custom-empty-${start}`,
            subsystem: 'settings-config',
            checkId,
            code: 'CUSTOM_MODEL_EMPTY_MISMATCH',
            severity: 'warning',
            title: 'Custom model selected without custom endpoint ID',
            explanation: 'translation.model="custom" with blank custom_model will fall back to gemini-3.8-flash.',
            timestamp: Date.now(),
          });
        }
        if (reviewProfile === 'conservative' && autoCorrect.isOverridden) {
          findings.push({
            findingId: `cfg-rev-override-${start}`,
            subsystem: 'settings-config',
            checkId,
            code: 'CONSERVATIVE_REVIEW_OVERRIDE',
            severity: 'info',
            title: 'Conservative review profile disables auto-correction',
            explanation: 'review.auto_correction_eligibility is safety-overridden to false while review.profile is "conservative".',
            timestamp: Date.now(),
          });
        }
        if (scanProfile === 'fast' && cropRetries) {
          findings.push({
            findingId: `cfg-fast-crop-${start}`,
            subsystem: 'settings-config',
            checkId,
            code: 'FAST_PROFILE_SKIPS_CROP_RETRIES',
            severity: 'info',
            title: 'Fast scan profile bypasses targeted crop retries',
            explanation: 'scanning.enable_crop_retries is enabled, but scanning.profile="fast" skips crop retries at runtime.',
            timestamp: Date.now(),
          });
        }

        const hasWarning = findings.some((f) => f.severity === 'warning' || f.severity === 'error');
        return {
          checkId,
          subsystem: 'settings-config',
          name: 'Runtime Configuration Mismatch Check',
          safety: 'read_only',
          status: hasWarning ? 'warning' : 'healthy',
          durationMs: Math.max(0, Date.now() - start),
          timestamp: Date.now(),
          summary: `Inspected active configuration cross-dependencies (${findings.length} note(s)/mismatch(es) detected).`,
          findings,
          metrics: {
            sourceLang,
            model,
            reviewProfile,
            scanProfile,
          },
        };
      }

      throw new Error(`Unsupported checkId "${checkId}" on settings-config inspector.`);
    },
  };
}
