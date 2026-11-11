import { SETTINGS_REGISTRY } from '../../services/settings/settingsRegistry';
import { settingsService } from '../../services/settings/settingsService';
import { useWorkbenchStore } from '../../store/workbenchStore';

export function settingsRegistrySnapshot(): Record<string, unknown> {
  const store = useWorkbenchStore.getState();
  const projectId = store.activeFolderId;
  const chapterId = store.activeChapterId;
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(SETTINGS_REGISTRY)) {
    try {
      const resolved = settingsService.getEffectiveValue(key, { projectId, chapterId });
      if (key.toLowerCase().includes('api_key')) {
        const hasVal = typeof resolved.value === 'string' && resolved.value.trim().length > 0;
        values[key] = {
          value: hasVal ? '[CONFIGURED_REDACTED]' : '[MISSING]',
          scope: resolved.effectiveScope,
          isOverridden: resolved.isOverridden,
        };
      } else {
        values[key] = {
          value: resolved.value,
          scope: resolved.effectiveScope,
          isOverridden: resolved.isOverridden,
          pending: settingsService.isPending(key),
        };
      }
    } catch {
      values[key] = { error: 'Failed to resolve effective setting' };
    }
  }

  return {
    revision: settingsService.getRevision(),
    activeProjectId: projectId,
    activeChapterId: chapterId,
    values,
  };
}
