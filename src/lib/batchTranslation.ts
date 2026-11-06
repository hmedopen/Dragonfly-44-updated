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
  rollingContextSnippet?: string;
}

export async function batchTranslateBubbles(
  options: BatchTranslateOptions
): Promise<Map<string, { rawText: string; humanizedText: string }>> {
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
    rollingContextSnippet,
  } = options;

  const translationMap = new Map<string, { rawText: string; humanizedText: string }>();

  // Filter bubbles that actually have source text and need translation
  const pendingBubbles = bubbles.filter(
    (b) =>
      b.sourceText &&
      b.sourceText.trim().length > 0 &&
      (!b.translatedText || b.translatedText.trim().length === 0 || !b.isManuallyEdited)
  );

  if (pendingBubbles.length === 0 || !apiKey) {
    return translationMap;
  }

  // Compile System #2 instructions
  const compiled = compileInstructions({
    task: 'page_scan',
    eloquenceLevel,
    translationFidelity,
    isHumanizerEnabled,
    humanizerIntensity,
    orthographyMode,
    masterPromptOverride,
    isMasterPromptActive,
    projectLore,
    chapterIntelligence,
    rollingContextSnippet,
  });

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

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[BatchTranslation] Translation call returned HTTP ${response.status}`);
      return translationMap;
    }

    const result = await response.json();
    const rawContent = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleanJson = extractCleanJson(rawContent);
    const parsed = JSON.parse(cleanJson);

    const items = Array.isArray(parsed.translations) ? parsed.translations : [];

    for (const item of items) {
      if (item.id && typeof item.translatedText === 'string') {
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
  } catch (err) {
    console.warn('[BatchTranslation] Error during batch translation pass:', err);
  }

  return translationMap;
}
