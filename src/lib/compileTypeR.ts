import type { BubbleItem } from '../types/workbench';

export interface TypeRCompileOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
  includePrefixTags: boolean;
  includeSourceComments: boolean;
  includeFlagNotes: boolean;
}

export interface RawTextExtractOptions {
  chapterName: string;
  pages: { pageIndex: number; bubbles: BubbleItem[] }[];
  includePageHeaders: boolean;
  includeIndexTags: boolean;
}

/**
 * Extracts raw source dialogue text across pages without translation.
 */
export function compileRawTextExtract(options: RawTextExtractOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeIndexTags = true,
  } = options;

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
      const source = bubble.sourceText ? bubble.sourceText.trim() : '';
      if (source) {
        lines.push(`${idxStr}${source}`);
      }
    }

    lines.push(''); // Blank separator between pages
  }

  return lines.join('\n').trim();
}

/**
 * Compiles dialogue bubbles across pages into Photoshop TypeR standard script format.
 * Preserves LTR prefix tags and RTL Arabic translations without bracket direction inversion.
 */
export function compileTypeRScript(options: TypeRCompileOptions): string {
  const {
    chapterName,
    pages,
    includePageHeaders = true,
    includeIndexTags = true,
    includePrefixTags = true,
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
      const prefixStr = includePrefixTags && bubble.typerPrefix ? `${bubble.typerPrefix} ` : '';
      const translation = bubble.translatedText || '[NO ARABIC TRANSLATION YET]';

      // Output line: isolated prefix + translation
      lines.push(`${idxStr}${prefixStr}${translation}`);

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
