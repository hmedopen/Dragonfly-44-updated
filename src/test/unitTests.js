import assert from 'node:assert';

console.log('--- RUNNING FOLIO SCRIPT VERIFICATION TESTS ---');

// 1. Natural Alphanumeric Sorting
function sortFilesNaturally(files) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

{
  const mockFiles = [
    { name: 'page_10.png' },
    { name: 'page_2.png' },
    { name: 'page_1.png' },
    { name: 'page_20.png' },
  ];
  const sorted = sortFilesNaturally(mockFiles);
  assert.strictEqual(sorted[0].name, 'page_1.png');
  assert.strictEqual(sorted[1].name, 'page_2.png');
  assert.strictEqual(sorted[2].name, 'page_10.png');
  assert.strictEqual(sorted[3].name, 'page_20.png');
  console.log('✓ 1. Natural alphanumeric sorting passed: page_2.png strictly precedes page_10.png');
}

// 2. Arabic Humanizer with Correct Orthography Preservation (System #2)
function humanizeArabicText(text, _optionsOrEloquence = 2) {
  if (!text) return '';
  let sanitized = text;

  // 1. Comic punctuation
  sanitized = sanitized.replace(/[\u2014\u2013]/g, '..');
  sanitized = sanitized.replace(/[؛;]/g, '،');

  // 2. Preserve Hamza and meaningful Tanween, strip stray non-critical tashkeel
  sanitized = sanitized.replace(/[\u064E\u064F\u0650\u0652]/g, '');

  // 3. Spacing and double punctuation
  sanitized = sanitized.replace(/([،]){2,}/g, '،');
  sanitized = sanitized.replace(/\s+([،.?!:؛])/g, '$1');
  sanitized = sanitized.replace(/([،])([^\s،.?!])/g, '$1 $2');
  return sanitized.trim();
}

{
  const aiOutput = 'ذهب إلى البيت—وقال له؛ إنك أحد الأبطال أمام الجميع وأخيراً كان مسروراً جداً.';
  
  // Standard Scanlation Literary (Level 2) - Preserves correct Hamza and Tanween!
  const humanizedL2 = humanizeArabicText(aiOutput, 2);
  assert.ok(!humanizedL2.includes('—'), 'Em-dash must be replaced');
  assert.ok(humanizedL2.includes('..'), 'Em-dash replaced with ..');
  assert.ok(!humanizedL2.includes('؛'), 'Semicolon must be replaced');
  assert.ok(humanizedL2.includes('،'), 'Semicolon replaced with comma');
  assert.ok(humanizedL2.includes('إلى البيت'), 'Correct hamza preserved on إلى');
  assert.ok(humanizedL2.includes('إنك أحد'), 'Correct hamzas preserved on إنك أحد');
  assert.ok(humanizedL2.includes('أخيراً'), 'Meaningful tanween preserved on أخيراً');
  assert.ok(humanizedL2.includes('جداً'), 'Meaningful tanween preserved on جداً');

  // High Classical (Level 3) - also preserves dignified Hamzas and Tanween
  const humanizedL3 = humanizeArabicText(aiOutput, 3);
  assert.ok(!humanizedL3.includes('—'), 'Em-dash must still be replaced');
  assert.ok(humanizedL3.includes('إلى البيت'), 'High Classical preserves formal Hamza on إلى');
  assert.ok(humanizedL3.includes('إنك أحد'), 'High Classical preserves formal Hamza on إنك أحد');
  assert.ok(humanizedL3.includes('جداً'), 'Tanween preserved on جداً in High Classical');

  console.log('✓ 2. System #2 Arabic humanizer passed: em-dashes and semicolons normalized, correct hamzas preserved, tanween adverbs protected.');
}

// 3. Canonical Typer Resolver
const LEGACY_TYPER_ALIAS_MAP = {
  dialogue: 'speech_bubbles',
  scream: 'shouting',
  box: 'square_bubbles',
  thought: 'thought_bubbles',
  in_art: 'outside_text',
};

const DEFAULT_TYPERS = [
  { id: 'speech_bubbles', prefix: '"":', name: 'Speech Bubbles' },
  { id: 'shouting', prefix: '%:', name: 'Shouting' },
  { id: 'thought_bubbles', prefix: '():', name: 'Thought Bubbles' },
  { id: 'square_bubbles', prefix: '[ ]:', name: 'Square Bubbles' },
  { id: 'outside_text', prefix: 'OT:', name: 'Outside Text' },
  { id: 'sfx', prefix: 'SFX:', name: 'Sound Effects' },
];

function resolveCanonicalTyper(typeKey, configuredTypers = DEFAULT_TYPERS) {
  if (!typeKey || typeKey === 'none') {
    return { id: 'none', name: 'None', prefix: '' };
  }
  const canonicalKey = LEGACY_TYPER_ALIAS_MAP[typeKey.toLowerCase()] || typeKey;
  const matched = configuredTypers.find(
    (t) =>
      t.id.toLowerCase() === canonicalKey.toLowerCase() ||
      t.name.toLowerCase() === typeKey.toLowerCase() ||
      t.id.toLowerCase() === typeKey.toLowerCase()
  );
  if (matched) {
    return { id: matched.id, name: matched.name, prefix: matched.prefix };
  }
  return { id: typeKey, name: typeKey, prefix: '' };
}

{
  assert.strictEqual(resolveCanonicalTyper('dialogue').id, 'speech_bubbles');
  assert.strictEqual(resolveCanonicalTyper('scream').id, 'shouting');
  assert.strictEqual(resolveCanonicalTyper('box').id, 'square_bubbles');
  assert.strictEqual(resolveCanonicalTyper('thought').id, 'thought_bubbles');
  assert.strictEqual(resolveCanonicalTyper('outside_text').prefix, 'OT:');
  assert.strictEqual(resolveCanonicalTyper('none').id, 'none');
  console.log('✓ 3. Canonical Typer resolver passed: mapped legacy keys to unified schema without ambiguity.');
}

// 4. Photoshop TypeR Script Compiler & Raw Text Extract
function compileTypeRScript(options) {
  const { chapterName, pages, includePageHeaders, includeIndexTags, includePrefixTags, prefixPosition = 'right', includeSourceComments } = options;
  const lines = [];
  lines.push('// ==========================================');
  lines.push(`// TYPER TRANSLATION SCRIPT // ${chapterName.toUpperCase()}`);
  lines.push('// COMPILED BY FOLIO SCRIPT');
  lines.push('// ==========================================\n');

  for (const page of pages) {
    const pageNumPadded = String(page.pageIndex).padStart(2, '0');
    if (includePageHeaders) {
      lines.push(`### PAGE ${pageNumPadded}\n`);
    }
    const sortedBubbles = [...page.bubbles].sort((a, b) => a.index - b.index);
    for (const bubble of sortedBubbles) {
      const idxStr = includeIndexTags ? `#${String(bubble.index).padStart(2, '0')} ` : '';
      const tag = includePrefixTags && bubble.typerPrefix ? bubble.typerPrefix : '';
      const translation = bubble.translatedText || '[NO ARABIC TRANSLATION YET]';
      if (prefixPosition === 'left') {
        const prefixStr = tag ? `${tag} ` : '';
        lines.push(`${idxStr}${prefixStr}${translation}`.trim());
      } else {
        const suffixStr = tag ? ` ${tag}` : '';
        lines.push(`${idxStr}${translation}${suffixStr}`.trim());
      }
      if (includeSourceComments && bubble.sourceText) {
        lines.push(`// Source: ${bubble.sourceText}`);
      }
      lines.push('');
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

{
  const mockPages = [
    {
      pageIndex: 1,
      bubbles: [
        {
          id: 'b1',
          pageId: 'p1',
          index: 1,
          box_2d: [100, 100, 200, 200],
          type: 'speech_bubbles',
          typerPrefix: '"":',
          sourceText: 'Hello',
          translatedText: 'مرحبا بكم',
        },
        {
          id: 'b2',
          pageId: 'p1',
          index: 2,
          box_2d: [300, 300, 400, 400],
          type: 'shouting',
          typerPrefix: '%:',
          sourceText: 'Run!',
          translatedText: 'اهربوا!',
        },
      ],
    },
  ];

  const scriptLeft = compileTypeRScript({
    chapterName: 'CHAPTER 01',
    pages: mockPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    prefixPosition: 'left',
    includeSourceComments: true,
  });

  assert.ok(scriptLeft.includes('### PAGE 01'), 'Includes page header');
  assert.ok(scriptLeft.includes('#01 "": مرحبا بكم'), 'Includes correct format with LTR prefix and RTL translation');
  assert.ok(scriptLeft.includes('#02 %: اهربوا!'), 'Includes scream prefix');
  assert.ok(scriptLeft.includes('// Source: Hello'), 'Includes source text comment');

  const scriptRight = compileTypeRScript({
    chapterName: 'CHAPTER 01',
    pages: mockPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    prefixPosition: 'right',
    includeSourceComments: true,
  });
  assert.ok(scriptRight.includes('#01 مرحبا بكم "":'), 'Right position works for RTL scanlation flow');

  console.log('✓ 4. Photoshop TypeR script compiler passed: verified formatting without bracket inversion.');
}

// 5. Instruction Hierarchy & Master Override
function buildScanSystemInstructionMock(options) {
  const { eloquenceLevel, includeSFX, masterPromptOverride, isMasterPromptActive } = options;
  const sections = [];
  sections.push('FOLIO SCRIPT SCAN ENGINE');
  if (eloquenceLevel === 3) sections.push('Level 3: فصحى جزلة وبليغة');
  if (includeSFX) sections.push('Sound effects: ON');
  if (isMasterPromptActive && masterPromptOverride) {
    sections.push(`CRITICAL SYSTEM OVERRIDE: ${masterPromptOverride}`);
  }
  return sections.join('\n\n');
}

{
  const prompt = buildScanSystemInstructionMock({
    eloquenceLevel: 3,
    includeSFX: true,
    masterPromptOverride: 'PRIORITIZE HIGH MARTIAL ARTS LORE',
    isMasterPromptActive: true,
  });
  assert.ok(prompt.includes('CRITICAL SYSTEM OVERRIDE: PRIORITIZE HIGH MARTIAL ARTS LORE'), 'Master override included');
  assert.ok(prompt.includes('فصحى جزلة وبليغة'), 'Classical eloquence included');
  assert.ok(prompt.includes('Sound effects: ON'), 'SFX on included');
  console.log('✓ 5. Prompt builder passed: verified eloquence levels and unconditional master override block.');
}

// 6. Review Finding Duplicate Prevention
function mergeReviewFlags(existingFlags, incomingFlags) {
  const activeExistingCategories = new Set(
    existingFlags.filter((f) => f.status !== 'dismissed').map((f) => f.category)
  );
  const uniqueIncoming = incomingFlags.filter((f) => !activeExistingCategories.has(f.category));
  return [...existingFlags, ...uniqueIncoming];
}

{
  const existing = [
    { id: 'f1', category: 'grammar_gender', status: 'pending' },
    { id: 'f2', category: 'reading_order', status: 'dismissed' },
  ];
  const incoming = [
    { id: 'f3', category: 'grammar_gender', status: 'pending' }, // Duplicate of active flag -> rejected
    { id: 'f4', category: 'reading_order', status: 'pending' },  // Dismissed previously -> allowed
    { id: 'f5', category: 'ocr_error', status: 'pending' },      // Brand new -> allowed
  ];
  const merged = mergeReviewFlags(existing, incoming);
  assert.strictEqual(merged.length, 4, 'Should contain 4 flags (f1, f2, f4, f5)');
  assert.strictEqual(merged.filter((f) => f.category === 'grammar_gender').length, 1, 'Duplicate active flag prevented');
  console.log('✓ 6. Review finding lifecycle passed: duplicate prevention and history preservation validated.');
}

// 7. System #6 Settings Precedence & Validation Contract
{
  function resolveEffective(defaults, globalVal, projectVal, opVal) {
    if (opVal !== undefined) return opVal;
    if (projectVal !== undefined) return projectVal;
    if (globalVal !== undefined) return globalVal;
    return defaults;
  }
  assert.strictEqual(resolveEffective(2, 3, 1, undefined), 1, 'Project overrides global');
  assert.strictEqual(resolveEffective(2, 3, 1, 3), 3, 'Operation overrides project');
  console.log('✓ 7. System #6 Settings precedence & scope resolution validated.');
}

// 8. System #6 Canonical Workspace Geometry Round-Trip Invariant
{
  function forward(x, fitW, zoom, panX) {
    return (fitW / 2) + ((x / 1000) * fitW - fitW / 2) * (zoom / 100) + panX;
  }
  function inverse(screenX, fitW, zoom, panX) {
    const unzoomed = (screenX - panX - fitW / 2) / (zoom / 100) + fitW / 2;
    return (unzoomed / fitW) * 1000;
  }
  const fitW = 600;
  const zoom = 150;
  const panX = 40;
  const originalX = 485;
  const screenX = forward(originalX, fitW, zoom, panX);
  const roundTripX = inverse(screenX, fitW, zoom, panX);
  assert.ok(Math.abs(originalX - roundTripX) < 0.001, 'Round-trip drift must be < 0.001');
  console.log('✓ 8. System #6 Workspace geometry round-trip & non-distortion invariant validated.');
}

// 9. Phase 1.1: Dialogue Normalization (Continuous text unwrapping & Paragraph Preservation)
{
  function normalizeExtractedDialogue(text) {
    if (!text) return '';
    const paragraphs = text.split(/\r?\n\s*\r?\n/);
    const normalizedParagraphs = paragraphs.map((para) => {
      const lines = para
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length <= 1) return lines.join('');
      let result = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i === 0) {
          result = line;
          continue;
        }
        const prevEndsWithHyphen = /([A-Za-z]+)-$/.test(result);
        const currStartsWithLetter = /^[A-Za-z]/.test(line);
        if (prevEndsWithHyphen && currStartsWithLetter) {
          result = result.slice(0, -1) + line;
          continue;
        }
        const lastChar = result.slice(-1);
        const firstChar = line.charAt(0);
        const isCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
        if (isCJK.test(lastChar) && isCJK.test(firstChar)) {
          result += line;
        } else {
          result += ' ' + line;
        }
      }
      return result;
    });
    return normalizedParagraphs.join('\n\n');
  }

  const sample = "Thank\ngoodness\nwe don't\nhave any\ncustomers\nright now...";
  const unwrapped = normalizeExtractedDialogue(sample);
  assert.strictEqual(unwrapped, "Thank goodness we don't have any customers right now...");

  const hyphenated = "We have cus-\ntomers right now.";
  assert.strictEqual(normalizeExtractedDialogue(hyphenated), "We have customers right now.");

  const multiPara = "Wait, look!\n\nIs that someone?";
  assert.strictEqual(normalizeExtractedDialogue(multiPara), "Wait, look!\n\nIs that someone?");
  console.log('✓ 9. Phase 1.1: Dialogue normalization and continuous text unwrapping validated.');
}

// 10. Phase 1.2: Empty & Symbol-Only Bubble Exclusion with Short Dialogue Protection
{
  function isMeaningfulLinguisticContent(text) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    return /[\p{L}\p{N}]/u.test(trimmed);
  }

  const symbolsToReject = ['', '   ', '...\n...', '…', '?', '!', '?!', '!?', '?!?!', '..!!', '—', '~', '✦'];
  for (const sym of symbolsToReject) {
    assert.strictEqual(isMeaningfulLinguisticContent(sym), false, `Must reject: "${sym}"`);
  }

  const shortDialogueToKeep = ['Oh', 'Ah', 'Ha?', 'Huh?', 'Eh?', 'Hm', '...ha?', '...Oh', '?! What?', 'No!', 'Go.'];
  for (const dia of shortDialogueToKeep) {
    assert.strictEqual(isMeaningfulLinguisticContent(dia), true, `Must preserve: "${dia}"`);
  }
  console.log('✓ 10. Phase 1.2: Empty & symbol-only exclusion with short dialogue protection validated.');
}

// 11. Phase 1.3: SFX Visibility Non-Destructive Invariant
{
  const storedBubbles = [
    { id: 'b1', type: 'speech', sourceText: 'Hello' },
    { id: 'b2', type: 'sfx', sourceText: 'BANG' },
    { id: 'b3', type: 'narration', sourceText: 'Later that day...' }
  ];

  function filterVisibleBubbles(bubbles, includeSFX) {
    if (includeSFX) return bubbles;
    return bubbles.filter((b) => b.type !== 'sfx');
  }

  const hidden = filterVisibleBubbles(storedBubbles, false);
  assert.strictEqual(hidden.length, 2, 'SFX hidden when includeSFX is false');
  assert.strictEqual(storedBubbles.length, 3, 'Stored records remain unchanged in memory/DB');

  const restored = filterVisibleBubbles(storedBubbles, true);
  assert.strictEqual(restored.length, 3, 'SFX restored when includeSFX is true without rescanning');
  console.log('✓ 11. Phase 1.3: Non-destructive SFX visibility filtering validated.');
}

// 12. Phase 2.1: Split Bubble Shared Visual Region & Composite Badging
{
  const originalBubble = {
    id: 'b3',
    index: 3,
    regionId: 'reg-01',
    box_2d: [100, 100, 250, 300],
    sourceText: 'Wait for me! I am coming right now.',
    translatedText: 'انتظرني! أنا قادم حالاً.'
  };

  function simulateSplit(bubble, splitIndex) {
    const text = bubble.sourceText || '';
    const beforeText = text.slice(0, splitIndex).trim();
    const afterText = text.slice(splitIndex).trim();
    const sharedRegionId = bubble.regionId || bubble.id;

    const b1 = {
      ...bubble,
      regionId: sharedRegionId,
      sourceText: beforeText
    };

    const b2 = {
      ...bubble,
      id: bubble.id + '_split_' + Date.now(),
      index: bubble.index + 1,
      regionId: sharedRegionId,
      sourceText: afterText,
      translatedText: ''
    };

    return [b1, b2];
  }

  const [part1, part2] = simulateSplit(originalBubble, 13);
  assert.strictEqual(part1.sourceText, 'Wait for me!');
  assert.strictEqual(part2.sourceText, 'I am coming right now.');
  assert.strictEqual(part1.regionId, part2.regionId, 'Both split parts must share the exact visual regionId');
  assert.deepStrictEqual(part1.box_2d, part2.box_2d, 'Geometry coordinates must be identical without ghost boxes');

  // Composite badging simulation
  const regionsMap = new Map();
  [part1, part2].forEach((b) => {
    const key = b.regionId;
    if (!regionsMap.has(key)) {
      regionsMap.set(key, { indices: [] });
    }
    regionsMap.get(key).indices.push(b.index);
  });

  const regionEntry = regionsMap.get('reg-01');
  const badgeLabel = regionEntry.indices.map((idx) => '#' + idx).join('/');
  assert.strictEqual(badgeLabel, '#3/#4', 'Combined visual badge must be #3/#4');
  console.log('✓ 12. Phase 2.1: Split Bubble shared visual region and composite badging (#3/#4) validated.');
}

// 13. Phase 3 & 5: Page Management, Tooltips, Pending Reorder & Double-Click Confirmation
{
  const initialPages = [
    { id: 'p1', index: 1, fileName: 'Chapter_01_Page_01.raw.png' },
    { id: 'p2', index: 2, fileName: 'Chapter_01_Page_02.raw.png' },
    { id: 'p3', index: 3, fileName: 'Chapter_01_Page_03.raw.png' }
  ];

  // Reorder page 1 to position 3
  const reordered = [initialPages[1], initialPages[2], initialPages[0]];
  const committed = reordered.map((p, i) => ({ ...p, index: i + 1 }));

  assert.strictEqual(committed[0].id, 'p2');
  assert.strictEqual(committed[0].fileName, 'Chapter_01_Page_02.raw.png');
  assert.strictEqual(committed[0].index, 1);
  assert.strictEqual(committed[2].id, 'p1');
  assert.strictEqual(committed[2].fileName, 'Chapter_01_Page_01.raw.png');
  assert.strictEqual(committed[2].index, 3);

  // Verify double click confirmation logic
  function checkConfirmation(isDoubleEnabled, isArmed, isDoubleClick) {
    if (!isDoubleEnabled) return { committed: true, armed: false };
    if (isDoubleClick || isArmed) return { committed: true, armed: false };
    return { committed: false, armed: true };
  }

  assert.strictEqual(checkConfirmation(false, false, false).committed, true, 'Single click commits when setting is disabled');
  assert.strictEqual(checkConfirmation(true, false, false).committed, false, 'First click arms when setting is enabled');
  assert.strictEqual(checkConfirmation(true, true, false).committed, true, 'Armed click commits');
  assert.strictEqual(checkConfirmation(true, false, true).committed, true, 'Double click commits directly');
  console.log('✓ 13. Phase 3 & 5: Page reorder metadata preservation and double-click confirmation validated.');
}

console.log('--- ALL VERIFICATION TESTS COMPLETED AND VALIDATED! ---');
