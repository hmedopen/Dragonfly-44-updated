import type { BubbleItem } from '../types/workbench';
import {
  normalizeTyperPrefix,
  type ExtractedTextDirection,
  type PrefixPosition,
  type TyperSymbolPosition,
} from '../types/typers';

export interface TypeRCompileOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
  includePrefixTags: boolean;
  prefixPosition?: PrefixPosition;
  symbolPosition?: TyperSymbolPosition;
  includeSourceComments: boolean;
  includeFlagNotes: boolean;
  includeSFX?: boolean;
}

export interface RawTextExtractOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
  includePrefixTags?: boolean;
  prefixPosition?: PrefixPosition;
  symbolPosition?: TyperSymbolPosition;
  textDirection?: ExtractedTextDirection;
  tagPlacement?: 'suffix' | 'prefix';
  includeSFX?: boolean;
}

/**
 * Extracts raw source dialogue text across pages without translation,
 * with optional TypeR tags and Unicode direction isolates for reliable plain-text reading.
 */
export function compileRawTextExtract(options: RawTextExtractOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeSFX = true,
    includeIndexTags = true,
    includePrefixTags = true,
    prefixPosition,
    symbolPosition,
    textDirection = 'rtl',
    tagPlacement = 'suffix',
  } = options;

  const effectivePlacement = symbolPosition
    ? symbolPosition === 'start' ? 'prefix' : 'suffix'
    : prefixPosition
      ? prefixPosition === 'left' ? 'prefix' : 'suffix'
      : tagPlacement;
  const directionStart = textDirection === 'rtl' ? '\u2067' : '\u2066';

  const lines: string[] = [];

  lines.push('// ==========================================');
  lines.push(`// EXTRACTED SOURCE DIALOGUE (NO TRANSLATION) // ${chapterName.toUpperCase()}`);
  lines.push('// COMPILED BY DRAGONFLY 44');
  lines.push('// ==========================================\n');

  for (const page of pages) {
    const pageNumPadded = String(page.pageIndex).padStart(2, '0');

    if (includePageHeaders && pages.length > 0) {
      lines.push(`### PAGE ${pageNumPadded}\n`);
    }

    const pageBubbles = includeSFX ? page.bubbles : page.bubbles.filter((b) => b.type !== 'sfx' && b.typerPrefix !== 'SFX:');
    const sortedBubbles = [...pageBubbles].sort((a, b) => a.index - b.index);

    for (const bubble of sortedBubbles) {
      const idxStr = includeIndexTags ? `#${String(bubble.index).padStart(2, '0')} ` : '';
      const tag = includePrefixTags && bubble.typerPrefix
        ? normalizeTyperPrefix(bubble.type, bubble.typerPrefix)
        : '';
      const isolatedTag = tag ? `\u2066${tag}\u2069` : '';
      const source = bubble.sourceText ? bubble.sourceText.trim() : '';

      if (effectivePlacement === 'prefix') {
        const prefixStr = isolatedTag ? `${isolatedTag} ` : '';
        const content = `${idxStr}${prefixStr}${source}`.trim();
        lines.push(`${directionStart}${content}\u2069`);
      } else {
        const suffixStr = isolatedTag ? ` ${isolatedTag}` : '';
        const content = `${idxStr}${source}${suffixStr}`.trim();
        lines.push(`${directionStart}${content}\u2069`);
      }
    }

    lines.push(''); // Blank separator between pages
  }

  return lines.join('\n').trim();
}

/**
 * Compiles dialogue bubbles across pages into Photoshop TypeR standard script format.
 * Respects includePrefixTags and symbolPosition, with prefixPosition as a legacy fallback.
 */
export function compileTypeRScript(options: TypeRCompileOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeIndexTags = true,
    includePrefixTags = true,
    prefixPosition = 'right',
    symbolPosition,
    includeSourceComments = true,
    includeFlagNotes = false,
    includeSFX = true,
  } = options;

  const lines: string[] = [];

  lines.push('// ==========================================');
  lines.push(`// TYPER TRANSLATION SCRIPT // ${chapterName.toUpperCase()}`);
  lines.push('// COMPILED BY DRAGONFLY 44');
  lines.push('// ==========================================\n');

  for (const page of pages) {
    const pageNumPadded = String(page.pageIndex).padStart(2, '0');

    if (includePageHeaders) {
      lines.push(`### PAGE ${pageNumPadded}\n`);
    }

    // Sort bubbles by index (1, 2, 3...)
    const pageBubbles = includeSFX ? page.bubbles : page.bubbles.filter((b) => b.type !== 'sfx' && b.typerPrefix !== 'SFX:');
    const sortedBubbles = [...pageBubbles].sort((a, b) => a.index - b.index);

    for (const bubble of sortedBubbles) {
      const idxStr = includeIndexTags ? `#${String(bubble.index).padStart(2, '0')} ` : '';
      const tag = includePrefixTags && bubble.typerPrefix ? bubble.typerPrefix : '';
      const translation = bubble.translatedText || '[NO ARABIC TRANSLATION YET]';
      const normalizedTag = tag ? normalizeTyperPrefix(bubble.type, tag) : '';
      const tagPosition = symbolPosition
        ? symbolPosition === 'start' ? 'prefix' : 'suffix'
        : prefixPosition === 'left' ? 'prefix' : 'suffix';

      if (tagPosition === 'prefix') {
        const prefixStr = normalizedTag ? `${normalizedTag} ` : '';
        lines.push(`${idxStr}${prefixStr}${translation}`.trim());
      } else {
        const suffixStr = normalizedTag ? ` ${normalizedTag}` : '';
        lines.push(`${idxStr}${translation}${suffixStr}`.trim());
      }

      if (includeSourceComments && bubble.sourceText) {
        lines.push(`// Source: ${bubble.sourceText}`);
      }

      if (includeFlagNotes && bubble.reviewFlags && bubble.reviewFlags.length > 0) {
        bubble.reviewFlags.forEach((flag) => {
          lines.push(`// Flag [${flag.category.toUpperCase()}]: ${flag.reasonAr}`);
        });
      }

      lines.push(''); // Blank delimiter between dialogue units
    }

    lines.push(''); // Blank separator between pages
  }

  return lines.join('\n').trim();
}
