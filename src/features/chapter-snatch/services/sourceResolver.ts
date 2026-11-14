import type { ChapterSource, ResolvedSourceInfo } from '../types';
import { sourceRegistry } from '../core/sourceRegistry';

export type { ResolvedSourceInfo };

export class ChapterSourceResolver {
  /**
   * Identifies the source from a user-supplied URL using the Fetch Core central registry.
   * Throws an Error with concise user-facing message if unsupported or invalid.
   */
  public static resolve(rawUrl: string): ResolvedSourceInfo {
    const { info } = sourceRegistry.resolve(rawUrl);
    return info;
  }

  /**
   * Fast detection of source type without throwing.
   */
  public static detectSource(rawUrl: string): ChapterSource | null {
    return (sourceRegistry.detectSource(rawUrl) as ChapterSource) || null;
  }
}
