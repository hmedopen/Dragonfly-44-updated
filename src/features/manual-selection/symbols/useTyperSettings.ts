import { useEffect, useState } from 'react';
import {
  loadTyperSettings,
  saveTyperSettings,
  TYPER_SETTINGS_STORAGE_KEY,
  type TyperSettings,
} from '../../../types/typers';

/**
 * Toggles a typer's pinned quick-access flag and persists immediately so
 * Manual Selection quick chips and other subscribers stay synchronized.
 */
export function toggleTyperPin(typerId: string): TyperSettings {
  const current = loadTyperSettings();
  const next: TyperSettings = {
    ...current,
    typers: current.typers.map((t) =>
      t.id === typerId ? { ...t, pinned: !t.pinned } : t
    ),
  };
  saveTyperSettings(next);
  return next;
}

/**
 * Reactive hook backed by Workspace Settings' shared typer configuration.
 * Updates immediately whenever typers, symbols, colors, order, or pins are saved.
 */
export function useTyperSettings(): TyperSettings {
  const [settings, setSettings] = useState<TyperSettings>(() => loadTyperSettings());

  useEffect(() => {
    const sync = () => {
      setSettings(loadTyperSettings());
    };
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === TYPER_SETTINGS_STORAGE_KEY) {
        sync();
      }
    };
    window.addEventListener('dragonfly44_typer_settings_updated', sync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('dragonfly44_typer_settings_updated', sync);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return settings;
}
