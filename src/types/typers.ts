export interface CustomTyperConfig {
  id: string;
  prefix: string;
  name: string;
  instructions: string;
  isDefault?: boolean;
  color?: string;
  pinned?: boolean;
}

export type PrefixPosition = 'right' | 'left';
export type TyperSymbolPosition = 'start' | 'end';
export type ExtractedTextDirection = 'rtl' | 'ltr';

export interface TyperSettings {
  includeTyperSymbols: boolean;
  /** Retained for pre-Start/End saved settings; new exports use symbolPosition. */
  prefixPosition: PrefixPosition;
  symbolPosition: TyperSymbolPosition;
  textDirection: ExtractedTextDirection;
  typers: CustomTyperConfig[];
}

export const TYPER_COLOR_SWATCHES: readonly string[] = [
  '#2563EB', // Cobalt Blue
  '#7C3AED', // Violet
  '#DC2626', // Crimson
  '#D97706', // Amber
  '#0284C7', // Cerulean
  '#DB2777', // Magenta Rose
  '#0D9488', // Teal
  '#059669', // Emerald
  '#4F46E5', // Indigo
  '#EA580C', // Terracotta
  '#65A30D', // Olive Lime
  '#E11D48', // Ruby
  '#9333EA', // Amethyst
  '#FACC15', // Gold
  '#06B6D4', // Cyan
  '#52525B', // Graphite
];

export const DEFAULT_TYPER_COLORS: Record<string, string> = {
  speech_bubbles: '#2563EB',
  thought_bubbles: '#7C3AED',
  shouting: '#DC2626',
  outside_text: '#D97706',
  small_text: '#0284C7',
  sfx: '#DB2777',
  system_messages: '#0D9488',
  translator_notes: '#059669',
  square_bubbles: '#4F46E5',
};

export const DEFAULT_PINNED_TYPER_IDS: readonly string[] = [
  'speech_bubbles',
  'thought_bubbles',
  'shouting',
];

export const DEFAULT_TYPERS: CustomTyperConfig[] = [
  {
    id: 'speech_bubbles',
    prefix: '"":',
    name: 'Speech Bubbles',
    instructions:
      'Ordinary spoken dialogue between characters in standard rounded or smooth oval speech bubbles. Casual, conversational speech with normal inflection.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.speech_bubbles,
    pinned: true,
  },
  {
    id: 'thought_bubbles',
    prefix: '():',
    name: 'Thought Bubbles',
    instructions:
      'Internal monologues, reflections, and unspoken thoughts, typically rendered in cloud-shaped, scalloped, or dotted/bubble-tailed thought bubbles.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.thought_bubbles,
    pinned: true,
  },
  {
    id: 'shouting',
    prefix: '%:',
    name: 'Shouting',
    instructions:
      'Loudly spoken or yelled dialogue, battle cries, screams, or urgent outbursts, usually enclosed in jagged, spiked, burst, or explosive bubble outlines.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.shouting,
    pinned: true,
  },
  {
    id: 'outside_text',
    prefix: 'OT:',
    name: 'Outside Text',
    instructions:
      'Narration, scene descriptions, editorial commentary, and textual dialogue drawn floating outside of conventional dialogue bubbles or in margin spaces.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.outside_text,
    pinned: false,
  },
  {
    id: 'small_text',
    prefix: 'ST:',
    name: 'Small Text',
    instructions:
      'Whispers, quiet murmurs, side remarks, secondary reactions, or small accompanying text hovering beside main dialogue bubbles.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.small_text,
    pinned: false,
  },
  {
    id: 'sfx',
    prefix: 'SFX:',
    name: 'Sound Effects',
    instructions:
      'Sound effects, onomatopoeia, impacts, environmental sounds, and combat audio rendered graphically into the scene art.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.sfx,
    pinned: false,
  },
  {
    id: 'system_messages',
    prefix: '$:',
    name: 'System Messages',
    instructions:
      'Game interfaces, status windows, automated notifications, skill announcements, system alerts, and holographic prompt boxes.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.system_messages,
    pinned: false,
  },
  {
    id: 'translator_notes',
    prefix: 'T/N:',
    name: 'Translator Notes',
    instructions:
      'Cultural, linguistic, historical, and translation explanations or scanlator commentary added to clarify terms.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.translator_notes,
    pinned: false,
  },
  {
    id: 'square_bubbles',
    prefix: '[ ]:',
    name: 'Square Bubbles',
    instructions:
      'Dialogue, formal narration, broadcast speech, telepathic transmissions, or internal commentary contained in rectangular or square-shaped bubbles.',
    isDefault: true,
    color: DEFAULT_TYPER_COLORS.square_bubbles,
    pinned: false,
  },
];

export const DEFAULT_TYPER_SETTINGS: TyperSettings = {
  includeTyperSymbols: true,
  prefixPosition: 'right',
  symbolPosition: 'start',
  textDirection: 'rtl',
  typers: DEFAULT_TYPERS,
};

export const TYPER_SETTINGS_STORAGE_KEY = 'dragonfly44_typer_settings';

// Legacy mapping bridge ensuring backward compatibility
export const LEGACY_TYPER_ALIAS_MAP: Record<string, string> = {
  dialogue: 'speech_bubbles',
  scream: 'shouting',
  box: 'square_bubbles',
  thought: 'thought_bubbles',
  in_art: 'outside_text',
};

const LEGACY_DEFAULT_PREFIXES: Record<string, string> = {
  speech_bubbles: '""',
  thought_bubbles: '()',
  shouting: '%',
  outside_text: 'OT',
  small_text: 'ST',
  sfx: 'SFX',
  system_messages: '$',
  translator_notes: 'T/N',
  square_bubbles: '[ ]',
};

export function normalizeHexColor(input: string | undefined | null, fallback = '#2563EB'): string {
  if (!input || typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return fallback;
}

export function getContrastForeground(hexColor: string): '#09090B' | '#FFFFFF' {
  const clean = normalizeHexColor(hexColor, '#2563EB').slice(1);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.34 ? '#09090B' : '#FFFFFF';
}

export function formatTyperSymbol(prefix: string | undefined | null, fallbackName?: string): string {
  const trimmed = (prefix || '').trim();
  if (trimmed.length > 0) {
    const stripped = trimmed.endsWith(':') ? trimmed.slice(0, -1).trim() : trimmed;
    if (stripped.length > 0) return stripped;
  }
  const cleanName = (fallbackName || '').trim();
  if (cleanName.length > 0) {
    return cleanName.slice(0, 2).toUpperCase();
  }
  return '?';
}

export function deriveFallbackTyperColor(idOrKey: string): string {
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[idOrKey.toLowerCase()] || idOrKey;
  if (DEFAULT_TYPER_COLORS[canonicalKey]) {
    return DEFAULT_TYPER_COLORS[canonicalKey];
  }
  let hash = 0;
  for (let i = 0; i < idOrKey.length; i++) {
    hash = (hash * 31 + idOrKey.charCodeAt(i)) >>> 0;
  }
  return TYPER_COLOR_SWATCHES[hash % (TYPER_COLOR_SWATCHES.length - 1)] || '#2563EB';
}

export function assignNextTyperColor(existingTypers: CustomTyperConfig[]): string {
  const used = new Set(existingTypers.map((t) => normalizeHexColor(t.color, '')));
  for (const swatch of TYPER_COLOR_SWATCHES) {
    if (!used.has(swatch)) return swatch;
  }
  return TYPER_COLOR_SWATCHES[existingTypers.length % (TYPER_COLOR_SWATCHES.length - 1)] || '#2563EB';
}

export function normalizeTyperPrefix(typeKey: string | undefined | null, prefix: string): string {
  if (!typeKey) return prefix;
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[typeKey.toLowerCase()] || typeKey;
  const legacyPrefix = LEGACY_DEFAULT_PREFIXES[canonicalKey.toLowerCase()];
  return legacyPrefix && prefix === legacyPrefix ? `${legacyPrefix}:` : prefix;
}

export function resolveCanonicalTyper(
  typeKey: string | undefined | null,
  configuredTypers?: CustomTyperConfig[]
): { id: string; name: string; prefix: string } {
  if (!typeKey || typeKey === 'none') {
    return { id: 'none', name: 'None', prefix: '' };
  }

  const typers = configuredTypers && configuredTypers.length > 0 ? configuredTypers : DEFAULT_TYPERS;
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[typeKey.toLowerCase()] || typeKey;

  const matched = typers.find(
    (t) =>
      t.id.toLowerCase() === canonicalKey.toLowerCase() ||
      t.name.toLowerCase() === typeKey.toLowerCase() ||
      t.id.toLowerCase() === typeKey.toLowerCase()
  );

  if (matched) {
    return { id: matched.id, name: matched.name, prefix: matched.prefix };
  }

  return { id: typeKey, name: typeKey, prefix: '' };
}

export interface ResolvedTyperVisual {
  typerId: string;
  name: string;
  prefix: string;
  symbol: string;
  color: string;
  fgColor: '#09090B' | '#FFFFFF';
  isClassified: boolean;
}

export function resolveTyperVisual(
  input: { type?: string | null; typerPrefix?: string | null; manualColorSnapshot?: string | null },
  configuredTypers?: CustomTyperConfig[]
): ResolvedTyperVisual {
  const rawType = input.type ? input.type.trim() : '';
  const rawPrefix = input.typerPrefix ? input.typerPrefix.trim() : '';

  if ((!rawType || rawType.toLowerCase() === 'none') && !rawPrefix) {
    return {
      typerId: 'none',
      name: 'Untyped',
      prefix: '',
      symbol: '',
      color: '#52525B',
      fgColor: '#FFFFFF',
      isClassified: false,
    };
  }

  const typers = configuredTypers && configuredTypers.length > 0 ? configuredTypers : DEFAULT_TYPERS;
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[rawType.toLowerCase()] || rawType;

  const matched = typers.find(
    (t) =>
      (canonicalKey && t.id.toLowerCase() === canonicalKey.toLowerCase()) ||
      (rawType && (t.id.toLowerCase() === rawType.toLowerCase() || t.name.toLowerCase() === rawType.toLowerCase())) ||
      (rawPrefix && normalizeTyperPrefix(t.id, t.prefix).toLowerCase() === rawPrefix.toLowerCase())
  );

  if (matched) {
    const color = normalizeHexColor(matched.color, deriveFallbackTyperColor(matched.id));
    return {
      typerId: matched.id,
      name: matched.name,
      prefix: matched.prefix,
      symbol: formatTyperSymbol(matched.prefix, matched.name),
      color,
      fgColor: getContrastForeground(color),
      isClassified: true,
    };
  }

  // Safe preservation if a custom typer was deleted after records referenced it
  const fallbackKey = canonicalKey || rawPrefix || 'custom';
  const color = normalizeHexColor(input.manualColorSnapshot, deriveFallbackTyperColor(fallbackKey));
  return {
    typerId: rawType || 'custom',
    name: rawType || rawPrefix || 'Custom',
    prefix: rawPrefix,
    symbol: formatTyperSymbol(rawPrefix, rawType),
    color,
    fgColor: getContrastForeground(color),
    isClassified: true,
  };
}

function hydrateTyperEntry(typer: CustomTyperConfig): CustomTyperConfig {
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[typer.id.toLowerCase()] || typer.id;
  return {
    ...typer,
    prefix: normalizeTyperPrefix(typer.id, typer.prefix),
    color: normalizeHexColor(typer.color, deriveFallbackTyperColor(canonicalKey)),
    pinned: typeof typer.pinned === 'boolean' ? typer.pinned : DEFAULT_PINNED_TYPER_IDS.includes(canonicalKey),
  };
}

export function loadTyperSettings(): TyperSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TYPER_SETTINGS;
    const raw = localStorage.getItem(TYPER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_TYPER_SETTINGS;
    const parsed = JSON.parse(raw);
    const storedSymbolPosition =
      parsed.symbolPosition === 'start' || parsed.symbolPosition === 'end'
        ? parsed.symbolPosition
        : parsed.prefixPosition === 'left'
          ? 'start'
          : parsed.prefixPosition === 'right'
            ? 'end'
            : DEFAULT_TYPER_SETTINGS.symbolPosition;
    return {
      includeTyperSymbols:
        typeof parsed.includeTyperSymbols === 'boolean'
          ? parsed.includeTyperSymbols
          : DEFAULT_TYPER_SETTINGS.includeTyperSymbols,
      prefixPosition:
        parsed.prefixPosition === 'left' || parsed.prefixPosition === 'right'
          ? parsed.prefixPosition
          : DEFAULT_TYPER_SETTINGS.prefixPosition,
      symbolPosition: storedSymbolPosition,
      textDirection:
        parsed.textDirection === 'rtl' || parsed.textDirection === 'ltr'
          ? parsed.textDirection
          : DEFAULT_TYPER_SETTINGS.textDirection,
      typers:
        Array.isArray(parsed.typers) && parsed.typers.length > 0
          ? parsed.typers.map(hydrateTyperEntry)
          : DEFAULT_TYPERS,
    };
  } catch (err) {
    console.error('Failed to load typer settings from localStorage:', err);
    return DEFAULT_TYPER_SETTINGS;
  }
}

export function saveTyperSettings(settings: TyperSettings): void {
  try {
    const sanitized: TyperSettings = {
      ...settings,
      typers: settings.typers.map(hydrateTyperEntry),
    };
    localStorage.setItem(TYPER_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const evt = typeof CustomEvent !== 'undefined'
        ? new CustomEvent('dragonfly44_typer_settings_updated', { detail: sanitized })
        : null;
      if (evt) window.dispatchEvent(evt);
    }
  } catch (err) {
    console.error('Failed to save typer settings to localStorage:', err);
  }
}
