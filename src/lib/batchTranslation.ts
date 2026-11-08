/**
 * Dragonfly 44: System #2 — Translation Engine Helper
 * Batch Dialogue Translator
 * 
 * Takes verified source texts produced by System #3 and translates them
 * into natural Arabic scanlation format following System #2 instruction compilation,
 * eloquence, fidelity, and orthography rules.
 */

import type {
  BubbleItem,
  EloquenceLevel,
  TranslationFidelity,
  HumanizerIntensity,
  OrthographyMode,
  ProjectLoreLedger,
  ChapterIntelligence,
} from '../types/workbench';
import { compileInstructions } from './instructionCompiler';
import { humanizeArabicText } from './arabicHumanizer';
import { extractCleanJson } from './translationValidator';
import { assembleTaskTrainingContext } from './training/trainingPromptInjection';

export interface BatchTranslateOptions {
  bubbles: BubbleItem[];
  pageContext?: string;
  apiKey: string;
  selectedModel?: string;
  eloquenceLevel: EloquenceLevel;
  translationFidelity?: TranslationFidelity;
  isHumanizerEnabled?: boolean;
  humanizerIntensity?: HumanizerIntensity;
  orthographyMode?: OrthographyMode;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
  projectLore?: ProjectLoreLedger | null;
  chapterIntelligence?: ChapterIntelligence | null;
  includeSFX?: boolean;
  rollingContextSnippet?: string;
  signal?: AbortSignal;
}

export interface BatchTranslationItemResult {
  rawText: string;
  humanizedText: string;
}

export interface BatchTranslationResult {
  success: boolean;
  translationMap: Map<string, BatchTranslationItemResult>;
  error?: string;
  requestedCount: number;
  translatedCount: number;
}

export async function batchTranslateBubbles(
  options: BatchTranslateOptions
): Promise<BatchTranslationResult> {
  const {
    bubbles,
    pageContext = '',
    apiKey,
    selectedModel = 'gemini-3.8-flash',
    eloquenceLevel,
    translationFidelity = 'localized',
    isHumanizerEnabled = true,
    humanizerIntensity = 'balanced',
    orthographyMode = 'correct_spelling',
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
    includeSFX,
    rollingContextSnippet,
    signal,
  } = options;

  const translationMap = new Map<string, BatchTranslationItemResult>();

  // Filter bubbles that actually have source text and need translation:
  // Retain valid translations; retranslate only missing translations or invalidated source text.
  // Never re-translate manually edited bubbles or already translated bubbles where source hasn't changed.
  const pendingBubbles = bubbles.filter((b) => {
    if (!b.sourceText || b.sourceText.trim().length === 0) return false;
    if (b.isManuallyEdited) return false;
    if (!includeSFX && (b.type === 'sfx' || b.typerPrefix === 'SFX:')) return false;
    // If not translated yet, it needs translation
    if (!b.translatedText || b.translatedText.trim().length === 0) return true;
    // If originalSourceText is tracked and differs from current sourceText, machine translation is invalidated
    if (b.originalSourceText && b.originalSourceText.trim() !== b.sourceText.trim()) return true;
    return false;
  });

  if (pendingBubbles.length === 0) {
    return {
      success: true,
      translationMap,
      requestedCount: 0,
      translatedCount: 0,
    };
  }

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      success: false,
      translationMap,
      error: 'Gemini API key is missing for batch translation.',
      requestedCount: pendingBubbles.length,
      translatedCount: 0,
    };
  }

  // Compile dedicated System #2 instructions for batch translation
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
    includeSFX,
    rollingContextSnippet,
  });

  // Query applicable enabled Reference Sets (Development Training Studio)
  const trainingContext = await assembleTaskTrainingContext({
    task: 'translation_quality',
    model: selectedModel,
    operationId: `translate_${Date.now()}`,
  });

  const effectiveSystemInstruction = trainingContext.hasTrainingContext
    ? `${compiled.systemInstruction}

${trainingContext.systemInstructionDirective}`
    : compiled.systemInstruction;

  const formattedDialogueList = pendingBubbles
    .map(
      (b) =>
        `- ID: "${b.id}" | #${String(b.index).padStart(2, '0')} [${b.type}]: "${b.sourceText.trim()}"`
    )
    .join('\n');

  const userPrompt = `Translate the following dialogue bubbles into dramatic, natural Arabic scanlation format.
${pageContext ? `Visual Scene Mood: ${pageContext}\n` : ''}
Lines to translate:
${formattedDialogueList}

Return strictly pure JSON with no markdown wrapping:
{
  "translations": [
    {
      "id": "bubble-id",
      "translatedText": "Natural Arabic translation"
    }
  ]
}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: effectiveSystemInstruction }],
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

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const errMsg = `[BatchTranslation] Translation call returned HTTP ${response.status}: ${errText}`;
      console.warn(errMsg);
      return {
        success: false,
        translationMap,
        error: errMsg,
        requestedCount: pendingBubbles.length,
        translatedCount: 0,
      };
    }

    const result = await response.json();
    const rawContent = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      return {
        success: false,
        translationMap,
        error: 'Model returned candidate without content parts.',
        requestedCount: pendingBubbles.length,
        translatedCount: 0,
      };
    }

    const cleanJson = extractCleanJson(rawContent);
    const parsed = JSON.parse(cleanJson);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.translations)) {
      return {
        success: false,
        translationMap,
        error: 'Model response missing "translations" array in batch translation schema.',
        requestedCount: pendingBubbles.length,
        translatedCount: 0,
      };
    }

    const items = parsed.translations;

    for (const item of items) {
      if (item && item.id && typeof item.translatedText === 'string') {
        const rawArabic = item.translatedText.trim();
        const humanizedArabic = isHumanizerEnabled
          ? humanizeArabicText(rawArabic, {
              eloquenceLevel,
              intensity: humanizerIntensity,
              orthographyMode,
              isDialectActive: compiled.isDialectActive,
            })
          : rawArabic;

        translationMap.set(item.id, {
          rawText: rawArabic,
          humanizedText: humanizedArabic,
        });
      }
    }

    return {
      success: translationMap.size > 0 || pendingBubbles.length === 0,
      translationMap,
      requestedCount: pendingBubbles.length,
      translatedCount: translationMap.size,
    };
  } catch (err: any) {
    if (signal?.aborted || err?.name === 'AbortError') {
      return {
        success: false,
        translationMap,
        error: 'Batch translation cancelled by user.',
        requestedCount: pendingBubbles.length,
        translatedCount: 0,
      };
    }
    const errMsg = `[BatchTranslation] Error during batch translation pass: ${err?.message || String(err)}`;
    console.warn(errMsg);
    return {
      success: false,
      translationMap,
      error: errMsg,
      requestedCount: pendingBubbles.length,
      translatedCount: 0,
    };
  }
}
