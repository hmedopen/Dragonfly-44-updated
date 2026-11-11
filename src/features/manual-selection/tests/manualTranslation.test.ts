import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsService } from '../../../services/settings/settingsService.ts';
import type { BubbleItem } from '../../../types/workbench.ts';
import {
  buildGroundedChapterContextSnippet,
  callGeminiWithBackoff,
  translateManualSelectionPages,
} from '../translation/manualTranslationService.ts';

function ensureStorageWithKey(apiKey: string) {
  const store = new Map<string, string>();
  if (typeof globalThis.window === 'undefined') {
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    };
    (globalThis as any).window = { localStorage: ls, dispatchEvent: () => true };
    (globalThis as any).localStorage = ls;
  }
  settingsService.setSettingValue('general.gemini_api_key', apiKey, { scope: 'global' });
}

function makeManualBubble(
  id: string,
  pageId: string,
  index: number,
  sourceText: string,
  extra?: Partial<BubbleItem>
): BubbleItem {
  return {
    id,
    pageId,
    chapterId: 'ch-1',
    index,
    box_2d: [100, 100, 200, 300],
    type: 'speech_bubbles',
    typerPrefix: '"":',
    sourceText,
    originalSourceText: sourceText,
    translatedText: '',
    rawTranslatedText: '',
    reviewFlags: [],
    provenance: 'manual_selection',
    manualSelectionShape: 'box',
    manualExtractionStatus: 'ocr_success',
    manualTranslationStatus: 'untranslated',
    ...extra,
  };
}

test('callGeminiWithBackoff retries HTTP 503 with exponential backoff and succeeds', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
    calls++;
    if (calls < 3) {
      return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"translations":[{"id":"b1","translatedText":"مرحبًا"}]}' }] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const data = await callGeminiWithBackoff(
    {
      endpoint: 'https://example.invalid/gemini',
      payload: {},
      maxRetries: 3,
      baseBackoffMs: 5,
    },
    mockFetch
  );

  assert.equal(calls, 3);
  assert.ok(data?.candidates?.[0]?.content?.parts?.[0]?.text);
});

test('Translate All builds grounded chapter context, preserves partial results on 503, retries failed only, and never mutates OCR', async () => {
  ensureStorageWithKey('AIzaSyTestKey1234567890');

  const b1 = makeManualBubble('b1', 'page-1', 1, 'Hello there.');
  const b2 = makeManualBubble('b2', 'page-2', 1, 'Wait for me!');

  const bubblesByPage = new Map<string, BubbleItem[]>([
    ['page-1', [b1]],
    ['page-2', [b2]],
  ]);

  const contextSnippet = buildGroundedChapterContextSnippet(
    [
      { id: 'page-1', index: 1 },
      { id: 'page-2', index: 2 },
    ],
    bubblesByPage,
    'page-2'
  );
  assert.match(contextSnippet, /Hello there\./);
  assert.ok(!contextSnippet.includes('Wait for me!'));

  let pageCallCount = 0;
  const partialOutageFetch: typeof fetch = async (_url, init) => {
    pageCallCount++;
    const bodyObj = JSON.parse(String(init?.body || '{}'));
    const promptText = String(bodyObj?.contents?.[0]?.parts?.[0]?.text || '');
    if (promptText.includes('ID: "b1"')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ translations: [{ id: 'b1', translatedText: 'مرحبًا بك.' }] }) }],
              },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response('503 overload', { status: 503 });
  };

  const res1 = await translateManualSelectionPages({
    projectId: null,
    chapterId: 'ch-1',
    pages: [
      { id: 'page-1', index: 1 },
      { id: 'page-2', index: 2 },
    ],
    bubblesByPage,
    targetPageIds: ['page-1', 'page-2'],
    deps: {
      fetchImpl: partialOutageFetch,
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      getRollingContextForPage: async () => ({
        summary: '',
        activeCharactersPrompt: '',
        terminologyPrompt: '',
        relationshipPrompt: '',
      }),
      maxRetries: 1,
      baseBackoffMs: 5,
    },
    onRegionResult: async (_pid, bubble, result) => {
      if (result.status === 'translated') {
        bubble.manualTranslationStatus = 'translated';
        bubble.translatedText = result.humanizedText;
      } else {
        bubble.manualTranslationStatus = 'translation_failed';
        bubble.manualTranslationError = result.error;
      }
    },
  });

  assert.ok(pageCallCount >= 2);
  assert.equal(res1.translatedCount, 1);
  assert.equal(res1.failedCount, 1);
  assert.equal(b1.manualTranslationStatus, 'translated');
  assert.equal(b1.sourceText, 'Hello there.', 'Source OCR must never be modified by translation');
  assert.deepEqual(b1.box_2d, [100, 100, 200, 300], 'Coordinates must never change');
  assert.equal(b2.manualTranslationStatus, 'translation_failed');
  assert.equal(b2.sourceText, 'Wait for me!', 'OCR preserved on 503 failure');

  const requestedIdsOnRetry: string[] = [];
  const recoveryFetch: typeof fetch = async (_url, init) => {
    const bodyObj = JSON.parse(String(init?.body || '{}'));
    const promptText = String(bodyObj?.contents?.[0]?.parts?.[0]?.text || '');
    if (promptText.includes('ID: "b1"')) requestedIdsOnRetry.push('b1');
    if (promptText.includes('ID: "b2"')) requestedIdsOnRetry.push('b2');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ translations: [{ id: 'b2', translatedText: 'انتظرني!' }] }) }],
            },
          },
        ],
      }),
      { status: 200 }
    );
  };

  const resRetry = await translateManualSelectionPages({
    projectId: null,
    chapterId: 'ch-1',
    pages: [
      { id: 'page-1', index: 1 },
      { id: 'page-2', index: 2 },
    ],
    bubblesByPage,
    targetPageIds: ['page-1', 'page-2'],
    onlyFailed: true,
    deps: {
      fetchImpl: recoveryFetch,
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      getRollingContextForPage: async () => ({
        summary: '',
        activeCharactersPrompt: '',
        terminologyPrompt: '',
        relationshipPrompt: '',
      }),
      maxRetries: 1,
      baseBackoffMs: 5,
    },
    onRegionResult: async (_pid, bubble, result) => {
      if (result.status === 'translated') {
        bubble.manualTranslationStatus = 'translated';
        bubble.translatedText = result.humanizedText;
      }
    },
  });

  assert.deepEqual(requestedIdsOnRetry, ['b2'], 'Retry Failed Only must skip already-translated b1');
  assert.equal(resRetry.translatedCount, 1);
  assert.equal(b2.manualTranslationStatus, 'translated');
});

test('Missing Gemini API key preserves OCR text and reports clean translation error without calling fetch', async () => {
  ensureStorageWithKey('');
  const b1 = makeManualBubble('b-nokey', 'page-1', 1, 'こんにちは');
  const bubblesByPage = new Map([['page-1', [b1]]]);

  let fetched = false;
  const res = await translateManualSelectionPages({
    projectId: null,
    chapterId: 'ch-1',
    pages: [{ id: 'page-1', index: 1 }],
    bubblesByPage,
    targetPageIds: ['page-1'],
    deps: {
      fetchImpl: async () => {
        fetched = true;
        throw new Error('Should not fetch without API key');
      },
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
    },
  });

  assert.equal(fetched, false);
  assert.equal(res.failedCount, 1);
  assert.match(res.fatalError || '', /API key/i);
  assert.equal(b1.sourceText, 'こんにちは');
});

test('Translate All cancellation aborts mid-chapter while keeping page 1 translation intact', async () => {
  ensureStorageWithKey('AIzaSyTestKey1234567890');
  const controller = new AbortController();
  const b1 = makeManualBubble('bc1', 'page-1', 1, 'First line');
  const b2 = makeManualBubble('bc2', 'page-2', 1, 'Second line');
  const bubblesByPage = new Map([
    ['page-1', [b1]],
    ['page-2', [b2]],
  ]);

  const res = await translateManualSelectionPages({
    projectId: null,
    chapterId: 'ch-1',
    pages: [
      { id: 'page-1', index: 1 },
      { id: 'page-2', index: 2 },
    ],
    bubblesByPage,
    targetPageIds: ['page-1', 'page-2'],
    signal: controller.signal,
    deps: {
      fetchImpl: async (_url, init) => {
        const bodyObj = JSON.parse(String(init?.body || '{}'));
        const promptText = String(bodyObj?.contents?.[0]?.parts?.[0]?.text || '');
        if (promptText.includes('ID: "bc1"')) {
          controller.abort();
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: [{ id: 'bc1', translatedText: 'السطر الأول' }] }) }] } }],
            }),
            { status: 200 }
          );
        }
        throw new Error('Page 2 must not start after cancellation');
      },
      getProjectLore: async () => null,
      getChapterIntelligence: async () => null,
      getRollingContextForPage: async () => ({
        summary: '',
        activeCharactersPrompt: '',
        terminologyPrompt: '',
        relationshipPrompt: '',
      }),
    },
    onRegionResult: async (_pid, bubble, result) => {
      if (result.status === 'translated') {
        bubble.manualTranslationStatus = 'translated';
        bubble.translatedText = result.humanizedText;
      }
    },
  });

  assert.equal(res.cancelled, true);
  assert.equal(res.translatedCount, 1);
  assert.equal(b1.manualTranslationStatus, 'translated');
  assert.equal(b2.manualTranslationStatus, 'untranslated');
});
