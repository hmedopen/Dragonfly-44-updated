export interface CustomTyperConfig {
  id: string;
  prefix: string;
  name: string;
  instructions: string;
  isDefault?: boolean;
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

export const DEFAULT_TYPERS: CustomTyperConfig[] = [
  {
    id: 'speech_bubbles',
    prefix: '"":',
    name: 'Speech Bubbles',
    instructions:
      'Ordinary spoken dialogue between characters in standard rounded or smooth oval speech bubbles. Casual, conversational speech with normal inflection.',
    isDefault: true,
  },
  {
    id: 'thought_bubbles',
    prefix: '():',
    name: 'Thought Bubbles',
    instructions:
      'Internal monologues, reflections, and unspoken thoughts, typically rendered in cloud-shaped, scalloped, or dotted/bubble-tailed thought bubbles.',
    isDefault: true,
  },
  {
    id: 'shouting',
    prefix: '%:',
    name: 'Shouting',
    instructions:
      'Loudly spoken or yelled dialogue, battle cries, screams, or urgent outbursts, usually enclosed in jagged, spiked, burst, or explosive bubble outlines.',
    isDefault: true,
  },
  {
    id: 'outside_text',
    prefix: 'OT:',
    name: 'Outside Text',
    instructions:
      'Narration, scene descriptions, editorial commentary, and textual dialogue drawn floating outside of conventional dialogue bubbles or in margin spaces.',
    isDefault: true,
  },
  {
    id: 'small_text',
    prefix: 'ST:',
    name: 'Small Text',
    instructions:
      'Whispers, quiet murmurs, side remarks, secondary reactions, or small accompanying text hovering beside main dialogue bubbles.',
    isDefault: true,
  },
  {
    id: 'sfx',
    prefix: 'SFX:',
    name: 'Sound Effects',
    instructions:
      'Sound effects, onomatopoeia, impacts, environmental sounds, and combat audio rendered graphically into the scene art.',
    isDefault: true,
  },
  {
    id: 'system_messages',
    prefix: '$:',
    name: 'System Messages',
    instructions:
      'Game interfaces, status windows, automated notifications, skill announcements, system alerts, and holographic prompt boxes.',
    isDefault: true,
  },
  {
    id: 'translator_notes',
    prefix: 'T/N:',
    name: 'Translator Notes',
    instructions:
      'Cultural, linguistic, historical, and translation explanations or scanlator commentary added to clarify terms.',
    isDefault: true,
  },
  {
    id: 'square_bubbles',
    prefix: '[ ]:',
    name: 'Square Bubbles',
    instructions:
      'Dialogue, formal narration, broadcast speech, telepathic transmissions, or internal commentary contained in rectangular or square-shaped bubbles.',
    isDefault: true,
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

export function loadTyperSettings(): TyperSettings {
  try {
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
          ? parsed.typers.map((typer: CustomTyperConfig) => ({
              ...typer,
              prefix: normalizeTyperPrefix(typer.id, typer.prefix),
            }))
          : DEFAULT_TYPERS,
    };
  } catch (err) {
    console.error('Failed to load typer settings from localStorage:', err);
    return DEFAULT_TYPER_SETTINGS;
  }
}

export function saveTyperSettings(settings: TyperSettings): void {
  try {
    localStorage.setItem(TYPER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('dragonfly44_typer_settings_updated', { detail: settings }));
  } catch (err) {
    console.error('Failed to save typer settings to localStorage:', err);
  }
}
