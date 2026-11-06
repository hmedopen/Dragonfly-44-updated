import type { BubbleItem } from '../types/workbench';
import type { PrefixPosition } from '../types/typers';

export interface TypeRCompileOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
  includePrefixTags: boolean;
  prefixPosition?: PrefixPosition;
  includeSourceComments: boolean;
  includeFlagNotes: boolean;
}

export interface RawTextExtractOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
  includePrefixTags?: boolean;
  prefixPosition?: PrefixPosition;
  tagPlacement?: 'suffix' | 'prefix';
}

/**
 * Extracts raw source dialogue text across pages without translation,
 * with optional TypeR tags (defaults to right/suffix format for Arabic-first workflow).
 */
export function compileRawTextExtract(options: RawTextExtractOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeIndexTags = true,
    includePrefixTags = true,
    prefixPosition,
    tagPlacement = 'suffix',
  } = options;

  // Determine effective placement: if prefixPosition is specified, 'right' maps to suffix and 'left' maps to prefix
  const effectivePlacement = prefixPosition ? (prefixPosition === 'left' ? 'prefix' : 'suffix') : tagPlacement;

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

    const sortedBubbles = [...page.bubbles].sort((a, b) => a.index - b.index);

    for (const bubble of sortedBubbles) {
      const idxStr = includeIndexTags ? `#${String(bubble.index).padStart(2, '0')} ` : '';
      const tag = includePrefixTags && bubble.typerPrefix ? bubble.typerPrefix : '';
      const source = bubble.sourceText ? bubble.sourceText.trim() : '';

      if (effectivePlacement === 'prefix') {
        const prefixStr = tag ? `${tag} ` : '';
        lines.push(`${idxStr}${prefixStr}${source}`.trim());
      } else {
        // Right / Suffix format
        const suffixStr = tag ? ` ${tag}` : '';
        lines.push(`${idxStr}${source}${suffixStr}`.trim());
      }
    }

    lines.push(''); // Blank separator between pages
  }

  return lines.join('\n').trim();
}

/**
 * Compiles dialogue bubbles across pages into Photoshop TypeR standard script format.
 * Respects includePrefixTags and prefixPosition (right vs left).
 */
export function compileTypeRScript(options: TypeRCompileOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeIndexTags = true,
    includePrefixTags = true,
    prefixPosition = 'right',
    includeSourceComments = true,
    includeFlagNotes = false,
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
    const sortedBubbles = [...page.bubbles].sort((a, b) => a.index - b.index);

    for (const bubble of sortedBubbles) {
      const idxStr = includeIndexTags ? `#${String(bubble.index).padStart(2, '0')} ` : '';
      const tag = includePrefixTags && bubble.typerPrefix ? bubble.typerPrefix : '';
      const translation = bubble.translatedText || '[NO ARABIC TRANSLATION YET]';

      if (prefixPosition === 'left') {
        const prefixStr = tag ? `${tag} ` : '';
        lines.push(`${idxStr}${prefixStr}${translation}`.trim());
      } else {
        // Right position: placed after Arabic text for seamless RTL flow
        const suffixStr = tag ? ` ${tag}` : '';
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
