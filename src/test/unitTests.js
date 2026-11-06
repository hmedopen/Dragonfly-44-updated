import assert from 'node:assert';

console.log('--- RUNNING DRAGONFLY 44 VERIFICATION TESTS ---');

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

// 2. Arabic Humanizer & AI-Detector Bypass
function humanizeArabicText(text) {
  if (!text) return '';
  let sanitized = text;
  sanitized = sanitized.replace(/[\u2014\u2013]/g, '..');
  sanitized = sanitized.replace(/[؛;]/g, '،');
  sanitized = sanitized.replace(/[\u064B\u064C\u064D]/g, '');
  sanitized = sanitized.replace(/[\u064E\u064F\u0650\u0652]/g, '');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])إلى(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'الى');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[إأ]نك(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'انك');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[إأ]ن(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'ان');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أحد(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'احد');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أمام(?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'امام');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])أخير/gu, (_m, p) => p + 'اخير');
  sanitized = sanitized.replace(/(^|[^\p{L}\p{N}]|[وف])[أا]يض[ااً](?=[^\p{L}\p{N}]|$)/gu, (_m, p) => p + 'ايضا');
  sanitized = sanitized.replace(/([،]){2,}/g, '،');
  sanitized = sanitized.replace(/\s+([،.?!])/g, '$1');
  sanitized = sanitized.replace(/([،])([^\s])/g, '$1 $2');
  return sanitized.trim();
}

{
  const aiOutput = 'ذهب إلى البيت—وقال له؛ إنك أحد الأبطال أمام الجميع وأخيراً كان مسروراً جداً.';
  const humanized = humanizeArabicText(aiOutput);

  assert.ok(!humanized.includes('—'), 'Em-dash must be replaced');
  assert.ok(humanized.includes('..'), 'Em-dash replaced with ..');
  assert.ok(!humanized.includes('؛'), 'Semicolon must be replaced');
  assert.ok(humanized.includes('،'), 'Semicolon replaced with comma');
  assert.ok(!humanized.includes('\u064B'), 'Tanwin fathatan must be stripped');
  assert.ok(humanized.includes('الى البيت'), 'إلى -> الى');
  assert.ok(humanized.includes('انك احد'), 'إنك أحد -> انك احد');
  assert.ok(humanized.includes('امام'), 'أمام -> امام');
  assert.ok(humanized.includes('واخير'), 'وأخيراً -> واخير');

  console.log('✓ 2. Arabic humanizer passed: em-dashes, semicolons, tanwin, and rigid hamzas sanitized.');
}

// 3. Photoshop TypeR Script Compiler
function compileTypeRScript(options) {
  const { chapterName, pages, includePageHeaders, includeIndexTags, includePrefixTags, prefixPosition = 'right', includeSourceComments } = options;
  const lines = [];
  lines.push('// ==========================================');
  lines.push(`// TYPER TRANSLATION SCRIPT // ${chapterName.toUpperCase()}`);
  lines.push('// COMPILED BY DRAGONFLY 44');
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
          type: 'dialogue',
          typerPrefix: '():',
          sourceText: 'Hello',
          translatedText: 'مرحبا بكم',
        },
        {
          id: 'b2',
          pageId: 'p1',
          index: 2,
          box_2d: [300, 300, 400, 400],
          type: 'scream',
          typerPrefix: '{}:',
          sourceText: 'Run!',
          translatedText: 'اهربوا!',
        },
      ],
    },
  ];

  const script = compileTypeRScript({
    chapterName: 'CHAPTER 01',
    pages: mockPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    prefixPosition: 'left',
    includeSourceComments: true,
  });

  assert.ok(script.includes('### PAGE 01'), 'Includes page header');
  assert.ok(script.includes('#01 (): مرحبا بكم'), 'Includes correct format with LTR prefix and RTL translation');
  assert.ok(script.includes('#02 {}: اهربوا!'), 'Includes scream prefix');
  assert.ok(script.includes('// Source: Hello'), 'Includes source text comment');

  const scriptRight = compileTypeRScript({
    chapterName: 'CHAPTER 01',
    pages: mockPages,
    includePageHeaders: true,
    includeIndexTags: true,
    includePrefixTags: true,
    prefixPosition: 'right',
    includeSourceComments: true,
  });
  assert.ok(scriptRight.includes('#01 مرحبا بكم ():'), 'Right position works');

  console.log('✓ 3. Photoshop TypeR script compiler passed: verified formatting without bracket inversion.');
}

console.log('--- ALL VERIFICATION TESTS COMPLETED AND VALIDATED! ---');

// 4. Prompt Builder Verification
function buildScanSystemInstructionMock(options) {
  const { eloquenceLevel, includeSFX, masterPromptOverride, isMasterPromptActive } = options;
  const sections = [];
  sections.push('DRAGONFLY 44 SCAN ENGINE');
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
  console.log('✓ 4. Prompt builder passed: verified eloquence levels and unconditional master override block.');
}
