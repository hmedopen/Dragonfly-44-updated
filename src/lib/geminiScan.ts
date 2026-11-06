import { getPageBlob, getProjectLore, saveProjectLore } from '../services/db';
import type { BubbleItem, GeminiModelKey, EloquenceLevel, TermLore, CharacterLore } from '../types/workbench';
import { loadTyperSettings } from '../types/typers';
import { buildScanSystemInstruction } from './promptBuilder';
import { humanizeArabicText } from './arabicHumanizer';

export interface ScanPageOptions {
  pageId: string;
  projectId?: string | null;
  isDraft?: boolean;
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  includeSFX: boolean;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

export interface ScanResult {
  bubbles: BubbleItem[];
  pageContext: string;
  detectedGlossaryTerms: Array<{ source: string; arabic: string; category: string }>;
}

/**
 * Converts a Blob or File to a base64 string without data prefix
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Executes a 1-Pass Multimodal Vision Scan on a single comic page
 */
export async function scanPageWithGemini(options: ScanPageOptions): Promise<ScanResult> {
  const {
    pageId,
    projectId,
    isDraft = false,
    apiKey,
    selectedModel,
    eloquenceLevel,
    includeSFX,
    masterPromptOverride,
    isMasterPromptActive,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  // 1. Retrieve the binary Blob from IndexedDB
  const blob = await getPageBlob(pageId);
  if (!blob) {
    throw new Error(`Page image blob not found in IndexedDB for ID: ${pageId}`);
  }

  // 2. Convert to base64 inlineData payload
  const mimeType = blob.type || 'image/png';
  const base64Data = await blobToBase64(blob);

  // 3. Fetch project lore if working in a Project (bypassed for Drafts)
  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;

  // 4. Fetch current configured typers
  const typerSettings = loadTyperSettings();

  // 5. Assemble system prompt
  const systemInstruction = buildScanSystemInstruction({
    eloquenceLevel,
    includeSFX,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive,
    typers: typerSettings.typers,
  });

  const effectiveModel = selectedModel || 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Extract all dialogue bubbles, boxes, shouts, thoughts, and text from this page. Provide bounding boxes [ymin, xmin, ymax, xmax] on a 0-1000 scale, accurate TypeR prefixes, and high-eloquence Arabic translations in structured JSON format.',
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response candidate.');
  }

  // Strip markdown codeblock backticks if present
  let cleanJson = rawText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('Failed to parse Gemini JSON output:', cleanJson, err);
    throw new Error('Failed to parse structured JSON from Gemini response.');
  }

  const rawBubbles = Array.isArray(parsed.bubbles) ? parsed.bubbles : [];
  const detectedGlossaryTerms = Array.isArray(parsed.detectedGlossaryTerms)
    ? parsed.detectedGlossaryTerms
    : [];

  // Map into BubbleItem schema with Humanizer post-processing
  // Map against active configured typers with non-empty instructions
  const eligibleTypersMap = new Map(
    typerSettings.typers
      .filter((t) => t.instructions && t.instructions.trim().length > 0)
      .map((t) => [t.id, t])
  );

  const bubbles: BubbleItem[] = rawBubbles.map((item: any, idx: number) => {
    const rawArabic = item.translatedText || '';
    const humanizedArabic = humanizeArabicText(rawArabic);
    
    // Check if the AI returned a valid configured typer ID
    let finalType = 'none';
    let finalPrefix = '';

    const returnedType = typeof item.type === 'string' ? item.type.trim() : '';
    if (eligibleTypersMap.has(returnedType)) {
      const matched = eligibleTypersMap.get(returnedType)!;
      finalType = matched.id;
      finalPrefix = matched.prefix;
    } else {
      // Also try matching by name or by prefix if AI output slightly varied
      const matchedByNameOrPrefix = Array.from(eligibleTypersMap.values()).find(
        (t) =>
          t.name.toLowerCase() === returnedType.toLowerCase() ||
          t.id.toLowerCase() === returnedType.toLowerCase() ||
          (t.prefix && item.typerPrefix && t.prefix.trim() === String(item.typerPrefix).trim())
      );
      if (matchedByNameOrPrefix) {
        finalType = matchedByNameOrPrefix.id;
        finalPrefix = matchedByNameOrPrefix.prefix;
      } else {
        // Untyped / none
        finalType = 'none';
        finalPrefix = '';
      }
    }

    return {
      id: `b-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      pageId,
      index: idx + 1,
      box_2d: Array.isArray(item.box_2d) && item.box_2d.length === 4 ? item.box_2d : [200, 200, 400, 400],
      type: finalType,
      typerPrefix: finalPrefix,
      sourceLanguage: item.sourceLanguage || 'ja',
      sourceText: item.sourceText || '',
      originalSourceText: item.sourceText || '',
      translatedText: humanizedArabic,
      rawTranslatedText: rawArabic,
      reviewFlags: [],
    };
  });

  // If working in a Project, merge newly discovered glossary terms into ProjectLoreLedger
  if (!isDraft && projectId && detectedGlossaryTerms.length > 0) {
    try {
      const existingLore = (await getProjectLore(projectId)) || {
        projectId,
        characters: [],
        terms: [],
        speakerRelationships: [],
        lastUpdated: Date.now(),
      };

      const existingTermKeys = new Set(existingLore.terms.map((t) => t.termOriginal.toLowerCase()));
      const existingCharKeys = new Set(existingLore.characters.map((c) => c.nameOriginal.toLowerCase()));

      let updated = false;

      for (const item of detectedGlossaryTerms) {
        if (!item.source || !item.arabic) continue;
        const key = item.source.toLowerCase();

        if (item.category === 'character' && !existingCharKeys.has(key)) {
          const newChar: CharacterLore = {
            id: `char-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            nameOriginal: item.source,
            nameArabic: humanizeArabicText(item.arabic),
          };
          existingLore.characters.push(newChar);
          existingCharKeys.add(key);
          updated = true;
        } else if (!existingTermKeys.has(key)) {
          const newTerm: TermLore = {
            id: `term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            termOriginal: item.source,
            termArabic: humanizeArabicText(item.arabic),
            category: item.category || 'term',
          };
          existingLore.terms.push(newTerm);
          existingTermKeys.add(key);
          updated = true;
        }
      }

      if (updated) {
        existingLore.lastUpdated = Date.now();
        await saveProjectLore(projectId, existingLore);
      }
    } catch (e) {
      console.warn('Could not auto-merge glossary terms into ProjectLoreLedger', e);
    }
  }

  return {
    bubbles,
    pageContext: parsed.pageContext || '',
    detectedGlossaryTerms,
  };
}

export interface TranslateSingleBubbleOptions {
  pageId: string;
  bubble: BubbleItem;
  surroundingBubbles?: BubbleItem[];
  projectId?: string | null;
  isDraft?: boolean;
  apiKey: string;
  selectedModel: GeminiModelKey | string;
  eloquenceLevel: EloquenceLevel;
  masterPromptOverride?: string;
  isMasterPromptActive?: boolean;
}

export interface SingleBubbleTranslationResult {
  sourceText?: string;
  translatedText: string;
}

/**
 * Translates a single bubble into Arabic using Gemini.
 * If sourceText is present, performs lightweight fast text translation.
 * If sourceText is empty and a page image is present, performs vision OCR + translation on the bubble area.
 */
export async function translateSingleBubbleWithGemini(
  options: TranslateSingleBubbleOptions
): Promise<SingleBubbleTranslationResult> {
  const {
    pageId,
    bubble,
    surroundingBubbles = [],
    projectId,
    isDraft = false,
    apiKey,
    selectedModel,
    eloquenceLevel,
    masterPromptOverride,
    isMasterPromptActive,
  } = options;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API key is required. Please set it in Hardware Settings (Ctrl+,).');
  }

  const projectLore = !isDraft && projectId ? await getProjectLore(projectId) : null;
  const systemInstruction = buildScanSystemInstruction({
    eloquenceLevel,
    includeSFX: true,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive,
  });

  const effectiveModel = selectedModel || 'gemini-3.1-flash-lite';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;

  // Assemble contextual dialogue history from other page bubbles (if present)
  let pageContextText = '';
  if (surroundingBubbles && surroundingBubbles.length > 0) {
    const contextualLines = surroundingBubbles
      .filter((b) => b.id !== bubble.id && (b.translatedText || b.sourceText))
      .sort((a, b) => a.index - b.index)
      .map(
        (b) =>
          `#${String(b.index).padStart(2, '0')} [${b.type}]: Source: "${b.sourceText || ''}" -> Arabic: "${b.translatedText || ''}"`
      )
      .join('\n');
    if (contextualLines.trim().length > 0) {
      pageContextText = `\n\nPage Context / Surrounding Dialogues:\n${contextualLines}`;
    }
  }

  // Assemble audit / review feedback if previous review left flags
  let reviewFlagsText = '';
  if (bubble.reviewFlags && bubble.reviewFlags.length > 0) {
    const flagNotes = bubble.reviewFlags
      .map(
        (f) =>
          `- [${f.category}]: Reason: ${f.reasonAr}${f.suggestedTextAr ? ` | Suggested fix: "${f.suggestedTextAr}"` : ''}`
      )
      .join('\n');
    reviewFlagsText = `\n\nPrevious QC/Review Audit Notes for this bubble:\n${flagNotes}\nPlease address these QC notes in the translation.`;
  }

  const hasSource = Boolean(bubble.sourceText && bubble.sourceText.trim().length > 0);
  let userParts: any[] = [];

  if (hasSource) {
    userParts = [
      {
        text: `Translate this single comic dialogue into natural Arabic scanlation format.\nBubble Index: #${String(bubble.index).padStart(2, '0')}\nBubble Type: ${bubble.type} (${bubble.typerPrefix || ''})\nSource Dialogue: "${bubble.sourceText.trim()}"${pageContextText}${reviewFlagsText}\n\nReturn strictly valid JSON:\n{\n  "translatedText": "Humanized Arabic translation"\n}`,
      },
    ];
  } else {
    // If no source text, try vision extraction from page image blob
    const blob = await getPageBlob(pageId);
    if (!blob) {
      throw new Error('No source dialogue text entered and scan page image not available.');
    }
    const mimeType = blob.type || 'image/png';
    const base64Data = await blobToBase64(blob);

    userParts = [
      {
        text: `Look at the comic dialogue bubble at normalized box [ymin, xmin, ymax, xmax] = [${bubble.box_2d.join(', ')}] on 0-1000 scale.\nTranscribe its original dialogue as sourceText, and translate it into high-eloquence Arabic as translatedText.${pageContextText}${reviewFlagsText}\n\nReturn strictly valid JSON:\n{\n  "sourceText": "Original text",\n  "translatedText": "Humanized Arabic translation"\n}`,
      },
      {
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      },
    ];
  }

  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: userParts,
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorMsg = errorBody?.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response.');
  }

  let cleanJson = rawText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    console.error('Failed to parse Gemini single translation JSON:', cleanJson, err);
    throw new Error('Failed to parse structured JSON from Gemini response.');
  }

  const rawArabic = parsed.translatedText || parsed.arabic || '';
  const humanized = humanizeArabicText(rawArabic);

  return {
    sourceText: parsed.sourceText ? String(parsed.sourceText).trim() : undefined,
    translatedText: humanized,
  };
}
