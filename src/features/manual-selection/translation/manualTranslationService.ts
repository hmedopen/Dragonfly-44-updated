import { humanizeArabicText } from '../../../lib/arabicHumanizer.ts';
import { compileInstructions } from '../../../lib/instructionCompiler.ts';
import { extractCleanJson } from '../../../lib/translationValidator.ts';
import { getProjectLore } from '../../../services/db.ts';
import { getChapterIntelligence, getRollingContextForPage } from '../../../services/intelligence.ts';
import { settingsService } from '../../../services/settings/settingsService.ts';
import { loadTyperSettings, resolveTyperVisual } from '../../../types/typers.ts';
import type {
  BubbleItem,
  ChapterIntelligence,
  EloquenceLevel,
  HumanizerIntensity,
  OrthographyMode,
  ProjectLoreLedger,
  TranslationFidelity,
} from '../../../types/workbench.ts';

export interface TranslationCallInput {
  endpoint: string;
  payload: unknown;
  signal?: AbortSignal;
}

export interface ManualTranslationDeps {
  fetchImpl?: typeof fetch;
  getProjectLore?: (projectId: string) => Promise<ProjectLoreLedger | null>;
  getChapterIntelligence?: (chapterId: string) => Promise<ChapterIntelligence | null>;
  getRollingContextForPage?: typeof getRollingContextForPage;
  maxRetries?: number;
  baseBackoffMs?: number;
}

export interface ManualPageTranslationOutcome {
  pageId: string;
  succeeded: Array<{
    bubbleId: string;
    rawText: string;
    humanizedText: string;
  }>;
  failed: Array<{
    bubbleId: string;
    error: string;
  }>;
  cancelled: boolean;
}

export class HttpStatusError extends Error {
  public readonly status: number;
  public readonly retryable: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.retryable = status === 429 || status === 502 || status === 503 || status === 504;
  }
}

function createAbortError(message = 'Translation cancelled by user.'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function waitInterruptibly(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpStatusError) return err.retryable;
  if (err && typeof err === 'object') {
    const msg = String((err as { message?: unknown }).message || '').toLowerCase();
    if (
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('502') ||
      msg.includes('504') ||
      msg.includes('overloaded') ||
      msg.includes('unavailable') ||
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('timeout')
    ) {
      return true;
    }
  }
  return false;
}

function readPageBubblesFromMap(
  source: Map<string, BubbleItem[]> | Record<string, BubbleItem[]>,
  pageId: string
): BubbleItem[] {
  if (source instanceof Map) {
    return source.get(pageId) || [];
  }
  return source[pageId] || [];
}

/**
 * Builds grounded chapter-wide dialogue context strictly from existing source lines.
 */
export function buildGroundedChapterContextSnippet(
  pages: Array<{ id: string; index: number }>,
  bubblesByPage: Map<string, BubbleItem[]> | Record<string, BubbleItem[]>,
  currentPageId: string
): string {
  const sortedPages = [...pages].sort((a, b) => a.index - b.index);
  const currentIdx = sortedPages.findIndex((p) => p.id === currentPageId);
  if (currentIdx === -1) return '';

  const typers = loadTyperSettings().typers;
  const lines: string[] = [];
  let charBudget = 2400;

  for (let i = 0; i < sortedPages.length; i++) {
    const p = sortedPages[i];
    if (p.id === currentPageId) continue;
    const pageItems = readPageBubblesFromMap(bubblesByPage, p.id)
      .filter((b) => b.sourceText && b.sourceText.trim().length > 0)
      .sort((a, b) => a.index - b.index);
    if (pageItems.length === 0) continue;

    const header = `Page ${p.index}:`;
    const entries = pageItems.map((b) => {
      const vis = resolveTyperVisual(b, typers);
      const transPart = b.translatedText?.trim() ? ` -> "${b.translatedText.trim()}"` : '';
      return `  #${b.index} [${vis.name}] "${b.sourceText.trim()}"${transPart}`;
    });
    const block = `${header}\n${entries.join('\n')}`;
    if (charBudget - block.length < 0 && lines.length > 0) {
      if (Math.abs(i - currentIdx) > 3) continue;
    }
    lines.push(block);
    charBudget -= block.length;
    if (charBudget <= 0) break;
  }

  if (lines.length === 0) return '';
  return `Extracted Chapter Dialogue Context (grounded strictly in existing extracted lines):\n${lines.join('\n')}`;
}

export async function callGeminiWithBackoff(
  options: TranslationCallInput & { maxRetries?: number; baseBackoffMs?: number },
  fetchImpl: typeof fetch = fetch
): Promise<any> {
  const maxRetries = Math.max(0, Math.min(4, options.maxRetries ?? 3));
  const baseBackoffMs = Math.max(10, options.baseBackoffMs ?? 1200);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.payload),
        signal: options.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new HttpStatusError(
          response.status,
          `Gemini API HTTP ${response.status}: ${errText || response.statusText}`
        );
      }

      return await response.json();
    } catch (err: any) {
      if (options.signal?.aborted || err?.name === 'AbortError') {
        throw createAbortError();
      }
      lastError = err;
      if (attempt < maxRetries && isRetryableError(err)) {
        const jitter = Math.round(Math.random() * 250);
        const delay = baseBackoffMs * Math.pow(2, attempt) + jitter;
        await waitInterruptibly(delay, options.signal);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface TranslateManualSelectionsOptions {
  projectId: string | null;
  chapterId: string | null;
  pages: Array<{ id: string; index: number }>;
  bubblesByPage: Map<string, BubbleItem[]> | Record<string, BubbleItem[]>;
  targetPageIds: string[];
  onlyFailed?: boolean;
  signal?: AbortSignal;
  deps?: ManualTranslationDeps;
  onPageStart?: (pageId: string, pageIndex: number) => void;
  onRegionResult?: (
    pageId: string,
    bubble: BubbleItem,
    result:
      | { status: 'translated'; rawText: string; humanizedText: string }
      | { status: 'translation_failed'; error: string }
  ) => Promise<void> | void;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Translates manually extracted records using Gemini contextual infrastructure.
 * Strictly preserves geometry, coordinates, typer assignments, and extracted source text.
 */
export async function translateManualSelectionPages(
  options: TranslateManualSelectionsOptions
): Promise<{
  totalRequested: number;
  translatedCount: number;
  failedCount: number;
  cancelled: boolean;
  pageOutcomes: ManualPageTranslationOutcome[];
  fatalError: string | null;
}> {
  const {
    projectId,
    chapterId,
    pages,
    bubblesByPage,
    targetPageIds,
    onlyFailed = false,
    signal,
    deps = {},
    onPageStart,
    onRegionResult,
    onProgress,
  } = options;

  const snapshot = settingsService.createOperationSnapshot({ projectId, chapterId });
  const apiKey = String(snapshot.values['general.gemini_api_key'] || '').trim();
  const selectedModel = settingsService.resolveEffectiveModel({ projectId, chapterId });
  const eloquenceLevel = (snapshot.values['translation.eloquence'] as EloquenceLevel) || 2;
  const translationFidelity =
    (snapshot.values['translation.fidelity'] as TranslationFidelity) || 'localized';
  const isHumanizerEnabled = Boolean(snapshot.values['translation.humanizer_enabled'] ?? true);
  const humanizerIntensity =
    (snapshot.values['translation.humanizer_intensity'] as HumanizerIntensity) || 'balanced';
  const orthographyMode =
    (snapshot.values['translation.orthography_mode'] as OrthographyMode) || 'correct_spelling';
  const masterPromptOverride = String(snapshot.values['translation.master_prompt_override'] || '');
  const isMasterPromptActive = Boolean(snapshot.values['translation.master_prompt_active'] ?? true);

  const loadLore = deps.getProjectLore ?? getProjectLore;
  const loadIntel = deps.getChapterIntelligence ?? getChapterIntelligence;
  const loadRolling = deps.getRollingContextForPage ?? getRollingContextForPage;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const configuredTypers = loadTyperSettings().typers;

  const pagePlan: Array<{ pageId: string; pageIndex: number; bubbles: BubbleItem[] }> = [];
  const sortedPages = [...pages].sort((a, b) => a.index - b.index);
  const targetSet = new Set(targetPageIds);

  for (const p of sortedPages) {
    if (!targetSet.has(p.id)) continue;
    const pageBubbles = readPageBubblesFromMap(bubblesByPage, p.id)
      .filter((b) => {
        if (b.provenance !== 'manual_selection') return false;
        if (!b.sourceText || b.sourceText.trim().length === 0) return false;
        if (onlyFailed) return b.manualTranslationStatus === 'translation_failed';
        return true;
      })
      .sort((a, b) => a.index - b.index);

    if (pageBubbles.length > 0) {
      pagePlan.push({ pageId: p.id, pageIndex: p.index, bubbles: pageBubbles });
    }
  }

  const totalRequested = pagePlan.reduce((sum, p) => sum + p.bubbles.length, 0);
  if (totalRequested === 0) {
    return {
      totalRequested: 0,
      translatedCount: 0,
      failedCount: 0,
      cancelled: false,
      pageOutcomes: [],
      fatalError: null,
    };
  }

  if (!apiKey) {
    const missingKeyMsg = 'Gemini API key is missing. Configure it in Settings to translate.';
    for (const pageItem of pagePlan) {
      for (const bubble of pageItem.bubbles) {
        await onRegionResult?.(pageItem.pageId, bubble, {
          status: 'translation_failed',
          error: missingKeyMsg,
        });
      }
    }
    return {
      totalRequested,
      translatedCount: 0,
      failedCount: totalRequested,
      cancelled: false,
      pageOutcomes: pagePlan.map((p) => ({
        pageId: p.pageId,
        succeeded: [],
        failed: p.bubbles.map((b) => ({ bubbleId: b.id, error: missingKeyMsg })),
        cancelled: false,
      })),
      fatalError: missingKeyMsg,
    };
  }

  const projectLore = projectId && projectId !== 'folder-drafts' ? await loadLore(projectId) : null;
  const chapterIntelligence = chapterId ? await loadIntel(chapterId) : null;

  let completedCount = 0;
  let translatedCount = 0;
  let failedCount = 0;
  const pageOutcomes: ManualPageTranslationOutcome[] = [];

  for (let pIdx = 0; pIdx < pagePlan.length; pIdx++) {
    const pageItem = pagePlan[pIdx];
    if (signal?.aborted) {
      return {
        totalRequested,
        translatedCount,
        failedCount,
        cancelled: true,
        pageOutcomes,
        fatalError: null,
      };
    }

    onPageStart?.(pageItem.pageId, pageItem.pageIndex);

    const chapterContextSnippet = buildGroundedChapterContextSnippet(
      pages,
      bubblesByPage,
      pageItem.pageId
    );

    let rollingSnippet = '';
    if (chapterId && pageItem.pageIndex > 1) {
      try {
        const prevPage = sortedPages.find((sp) => sp.index === pageItem.pageIndex - 1);
        const prevBubbles = prevPage ? readPageBubblesFromMap(bubblesByPage, prevPage.id) : [];
        const rolling = await loadRolling(
          chapterId,
          pageItem.pageIndex,
          prevBubbles.map((b) => ({
            index: b.index,
            type: b.type,
            sourceText: b.sourceText,
            translatedText: b.translatedText,
          }))
        );
        rollingSnippet = [
          rolling.summary ? `Chapter Summary: ${rolling.summary}` : '',
          rolling.activeCharactersPrompt ? `Characters:\n${rolling.activeCharactersPrompt}` : '',
          rolling.terminologyPrompt ? `Terminology:\n${rolling.terminologyPrompt}` : '',
          rolling.relationshipPrompt ? `Relationships:\n${rolling.relationshipPrompt}` : '',
          rolling.precedingDialogueSnippet || '',
        ]
          .filter(Boolean)
          .join('\n\n');
      } catch {
        // Non-fatal rolling context fallback
      }
    }

    const combinedContext = [rollingSnippet, chapterContextSnippet].filter(Boolean).join('\n\n');

    const compiled = compileInstructions({
      task: 'batch_translation',
      eloquenceLevel,
      translationFidelity,
      isHumanizerEnabled,
      humanizerIntensity,
      orthographyMode,
      masterPromptOverride,
      isMasterPromptActive,
      projectLore,
      chapterIntelligence,
      includeSFX: true,
      rollingContextSnippet: combinedContext || undefined,
    });

    const formattedList = pageItem.bubbles
      .map((b) => {
        const vis = resolveTyperVisual(b, configuredTypers);
        return `- ID: "${b.id}" | #${String(b.index).padStart(2, '0')} [${vis.name}]: "${b.sourceText.trim()}"`;
      })
      .join('\n');

    const userPrompt = `Translate the following manually selected comic dialogue records into natural Arabic scanlation format.
Preserve every record ID separately. Do NOT merge, split, skip, or alter source lines.
Page ${pageItem.pageIndex} lines:
${formattedList}

Return strictly valid JSON:
{
  "translations": [
    {
      "id": "region-id",
      "translatedText": "Natural Arabic translation"
    }
  ]
}`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: {
        parts: [{ text: compiled.systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generation_config: {
        response_mime_type: 'application/json',
        temperature: 0.2,
      },
    };

    const pageOutcome: ManualPageTranslationOutcome = {
      pageId: pageItem.pageId,
      succeeded: [],
      failed: [],
      cancelled: false,
    };

    try {
      const result = await callGeminiWithBackoff(
        {
          endpoint,
          payload,
          signal,
          maxRetries: deps.maxRetries ?? 3,
          baseBackoffMs: deps.baseBackoffMs ?? 1200,
        },
        fetchImpl
      );

      const rawContent = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanJson = extractCleanJson(rawContent);
      const parsed = JSON.parse(cleanJson);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.translations)) {
        throw new Error('Gemini response missing "translations" array.');
      }

      const byId = new Map<string, string>();
      for (const entry of parsed.translations) {
        if (entry && typeof entry.id === 'string' && typeof entry.translatedText === 'string') {
          byId.set(entry.id, entry.translatedText.trim());
        }
      }

      for (const bubble of pageItem.bubbles) {
        const rawArabic = byId.get(bubble.id);
        if (!rawArabic) {
          const missingMsg = 'Gemini omitted translation for this selection.';
          failedCount++;
          pageOutcome.failed.push({ bubbleId: bubble.id, error: missingMsg });
          await onRegionResult?.(pageItem.pageId, bubble, {
            status: 'translation_failed',
            error: missingMsg,
          });
        } else {
          const humanizedArabic = isHumanizerEnabled
            ? humanizeArabicText(rawArabic, {
                eloquenceLevel,
                intensity: humanizerIntensity,
                orthographyMode,
                isDialectActive: compiled.isDialectActive,
              })
            : rawArabic;
          translatedCount++;
          pageOutcome.succeeded.push({
            bubbleId: bubble.id,
            rawText: rawArabic,
            humanizedText: humanizedArabic,
          });
          await onRegionResult?.(pageItem.pageId, bubble, {
            status: 'translated',
            rawText: rawArabic,
            humanizedText: humanizedArabic,
          });
        }
        completedCount++;
        onProgress?.(completedCount, totalRequested);
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') {
        pageOutcome.cancelled = true;
        pageOutcomes.push(pageOutcome);
        return {
          totalRequested,
          translatedCount,
          failedCount,
          cancelled: true,
          pageOutcomes,
          fatalError: null,
        };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      for (const bubble of pageItem.bubbles) {
        failedCount++;
        pageOutcome.failed.push({ bubbleId: bubble.id, error: errMsg });
        await onRegionResult?.(pageItem.pageId, bubble, {
          status: 'translation_failed',
          error: errMsg,
        });
        completedCount++;
        onProgress?.(completedCount, totalRequested);
      }
    }

    pageOutcomes.push(pageOutcome);
  }

  return {
    totalRequested,
    translatedCount,
    failedCount,
    cancelled: false,
    pageOutcomes,
    fatalError: null,
  };
}
