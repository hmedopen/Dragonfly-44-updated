import { getPageBlob, getProjectLore, saveProjectLore } from '../services/db';
import type { BubbleItem, GeminiModelKey, EloquenceLevel, TermLore, CharacterLore } from '../types/workbench';
import { BUBBLE_TYPE_CONFIG } from '../types/workbench';
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

  // 4. Assemble system prompt
  const systemInstruction = buildScanSystemInstruction({
    eloquenceLevel,
    includeSFX,
    projectLore,
    masterPromptOverride,
    isMasterPromptActive,
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
  const bubbles: BubbleItem[] = rawBubbles.map((item: any, idx: number) => {
    const rawArabic = item.translatedText || '';
    const humanizedArabic = humanizeArabicText(rawArabic);
    const bubbleType = (item.type || 'dialogue').toLowerCase();
    const config = BUBBLE_TYPE_CONFIG[bubbleType as keyof typeof BUBBLE_TYPE_CONFIG] || BUBBLE_TYPE_CONFIG.dialogue;

    return {
      id: `b-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
      pageId,
      index: idx + 1,
      box_2d: Array.isArray(item.box_2d) && item.box_2d.length === 4 ? item.box_2d : [200, 200, 400, 400],
      type: bubbleType,
      typerPrefix: item.typerPrefix || config.prefix,
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
