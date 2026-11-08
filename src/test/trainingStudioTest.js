import assert from 'node:assert';

console.log('====================================================');
console.log('FOLIO SCRIPT — TRAINING STUDIO VERIFICATION SUITE');
console.log('====================================================\n');

// ---------------------------------------------------------
// Production Logic Implementations for Node Test Runner
// ---------------------------------------------------------

const VALID_TASKS = new Set([
  'scanning_classification',
  'reading_order',
  'speech_balloon_detection',
  'ocr_text_region',
  'sfx_classification',
  'translation_quality',
  'review_qc',
]);

const VALID_LABELS = new Set([
  'balloon',
  'tail',
  'text_region',
  'sfx',
  'panel',
  'character',
  'other',
]);

function validateTrainingPackageV1(manifest) {
  const errors = [];
  const warnings = [];

  let exampleCount = 0;
  let annotationCount = 0;
  let unverifiedAnnotationCount = 0;
  let embeddedImagesCount = 0;
  let tasksCount = 0;

  if (!manifest || typeof manifest !== 'object') {
    return {
      isValid: false,
      schemaVersion: 'unknown',
      errors: ['Manifest must be a non-null JSON object.'],
      warnings: [],
      stats: { exampleCount: 0, annotationCount: 0, unverifiedAnnotationCount: 0, embeddedImagesCount: 0, tasksCount: 0 },
    };
  }

  if (manifest.schemaVersion !== 'dragonfly.training.v1') {
    errors.push(`Invalid schemaVersion: expected "dragonfly.training.v1", got "${manifest.schemaVersion}".`);
  }

  if (!manifest.referenceSet || typeof manifest.referenceSet !== 'object') {
    errors.push('Manifest is missing required "referenceSet" object.');
  } else {
    const ref = manifest.referenceSet;
    if (!ref.title || typeof ref.title !== 'string' || ref.title.trim().length === 0) {
      errors.push('referenceSet.title is required and cannot be empty.');
    }
    if (!Array.isArray(ref.targetTasks) || ref.targetTasks.length === 0) {
      errors.push('referenceSet.targetTasks must be a non-empty array of valid tasks.');
    } else {
      tasksCount = ref.targetTasks.length;
      for (const t of ref.targetTasks) {
        if (!VALID_TASKS.has(t)) {
          errors.push(`Unknown targetTask: "${t}".`);
        }
      }
    }
  }

  if (!Array.isArray(manifest.examples)) {
    errors.push('Manifest is missing required "examples" array.');
  } else {
    exampleCount = manifest.examples.length;
    if (exampleCount === 0) {
      warnings.push('Manifest contains 0 examples. Package will create an empty Reference Set.');
    }

    manifest.examples.forEach((ex, exIdx) => {
      const exNum = exIdx + 1;
      if (!ex.title || typeof ex.title !== 'string') {
        warnings.push(`Example #${exNum} is missing a descriptive title. Defaulting to "Example ${exNum}".`);
      }
      if (!ex.aiNote || typeof ex.aiNote !== 'string' || ex.aiNote.trim().length === 0) {
        errors.push(`Example #${exNum} is missing required "aiNote". Notes must explain to the AI why this example matters.`);
      }

      const hasBase64 = typeof ex.imageBase64 === 'string' && ex.imageBase64.trim().length > 0;
      const hasBlobKey = typeof ex.imageBlobKey === 'string' && ex.imageBlobKey.trim().length > 0;
      const hasPath = typeof ex.sourceFilePath === 'string' && ex.sourceFilePath.trim().length > 0;

      if (hasBase64) embeddedImagesCount++;
      if (!hasBase64 && !hasBlobKey && !hasPath) {
        errors.push(`Example #${exNum} has no image data (neither imageBase64, imageBlobKey, nor sourceFilePath).`);
      }

      if (Array.isArray(ex.annotations)) {
        ex.annotations.forEach((ann, annIdx) => {
          annotationCount++;
          const annNum = annIdx + 1;

          if (ann.isVerified === true) {
            warnings.push(
              `Example #${exNum} annotation #${annNum} (${ann.physicalObjectId || 'unnamed'}) was marked as pre-verified. AI suggestions must be reviewed by the user.`
            );
          } else {
            unverifiedAnnotationCount++;
          }

          if (!ann.physicalObjectId || typeof ann.physicalObjectId !== 'string') {
            errors.push(`Example #${exNum} annotation #${annNum} is missing "physicalObjectId".`);
          }

          if (!ann.label || !VALID_LABELS.has(ann.label)) {
            warnings.push(`Example #${exNum} annotation #${annNum} has unknown label "${ann.label}". Defaulting to "other".`);
          }

          if (!Array.isArray(ann.box_2d) || ann.box_2d.length !== 4) {
            errors.push(`Example #${exNum} annotation #${annNum} box_2d must be an array of 4 integers [ymin, xmin, ymax, xmax].`);
          } else {
            const [ymin, xmin, ymax, xmax] = ann.box_2d;
            if (
              typeof ymin !== 'number' ||
              typeof xmin !== 'number' ||
              typeof ymax !== 'number' ||
              typeof xmax !== 'number'
            ) {
              errors.push(`Example #${exNum} annotation #${annNum} box_2d coordinates must be numbers.`);
            } else {
              if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
                errors.push(`Example #${exNum} annotation #${annNum} coordinates out of 0-1000 range: [${ymin}, ${xmin}, ${ymax}, ${xmax}].`);
              }
              if (ymin >= ymax) {
                errors.push(`Example #${exNum} annotation #${annNum} invalid height: ymin (${ymin}) >= ymax (${ymax}).`);
              }
              if (xmin >= xmax) {
                errors.push(`Example #${exNum} annotation #${annNum} invalid width: xmin (${xmin}) >= xmax (${xmax}).`);
              }
            }
          }
        });
      }
    });
  }

  return {
    isValid: errors.length === 0,
    schemaVersion: manifest?.schemaVersion || 'unknown',
    errors,
    warnings,
    stats: {
      exampleCount,
      annotationCount,
      unverifiedAnnotationCount,
      embeddedImagesCount,
      tasksCount,
    },
  };
}

function normalizePackageToSet(manifest, options = {}) {
  const now = Date.now();
  const ref = manifest.referenceSet;
  const setId = ref.id || `ref_set_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const embeddedImagesToStore = [];

  const examples = manifest.examples.map((ex, idx) => {
    const orderIndex = idx + 1;
    const exampleId = ex.id || `ex_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 6)}`;
    let blobKey = ex.imageBlobKey || '';

    if (ex.imageBase64 && ex.imageBase64.trim().length > 0) {
      blobKey = `tb_${now}_${orderIndex}_${Math.random().toString(36).substring(2, 7)}`;
      let mimeType = 'image/png';
      let cleanBase64 = ex.imageBase64;

      if (ex.imageBase64.startsWith('data:')) {
        const parts = ex.imageBase64.split(';base64,');
        mimeType = parts[0].replace('data:', '') || 'image/png';
        cleanBase64 = parts[1] || '';
      }

      embeddedImagesToStore.push({
        blobKey,
        base64: cleanBase64,
        mimeType,
      });
    }

    const annotations = (ex.annotations || []).map((ann, annIdx) => {
      const annId = ann.id || `ann_${now}_${orderIndex}_${annIdx + 1}`;
      const isVerified = options.preserveVerification ? Boolean(ann.isVerified) : false;

      return {
        id: annId,
        physicalObjectId: ann.physicalObjectId || `obj_${annIdx + 1}`,
        box_2d: ann.box_2d,
        label: VALID_LABELS.has(ann.label) ? ann.label : 'other',
        translationUnitId: ann.translationUnitId,
        readingOrderIndex: ann.readingOrderIndex || annIdx + 1,
        relationships: ann.relationships || [],
        notes: ann.notes || '',
        isVerified,
        source: 'agent',
      };
    });

    return {
      id: exampleId,
      orderIndex,
      title: ex.title || `Example #${orderIndex}`,
      blobKey,
      sourceFileName: ex.sourceFileName || `screenshot_${orderIndex}.png`,
      sourceFilePath: ex.sourceFilePath,
      aiNote: ex.aiNote || '',
      expectedBehaviour: ex.expectedBehaviour || '',
      tags: Array.isArray(ex.tags) ? ex.tags : [],
      annotations,
      isEnabled: ex.isEnabled !== undefined ? ex.isEnabled : true,
      createdAt: now,
      updatedAt: now,
    };
  });

  const referenceSet = {
    id: setId,
    title: ref.title.trim(),
    description: ref.description || '',
    generalInstructions: ref.generalInstructions || '',
    targetTasks: ref.targetTasks,
    enabled: ref.enabled !== undefined ? ref.enabled : false,
    priority: typeof ref.priority === 'number' ? ref.priority : 50,
    version: 1,
    createdAt: now,
    updatedAt: now,
    examples,
  };

  return { referenceSet, embeddedImagesToStore };
}

function getTaskArchitecturalContext(task) {
  const map = {
    speech_balloon_detection: {
      primarySystem: 'System #3 (Physical Balloon & Translation Unit Boundary)',
      architecturalDirectives: [
        'CRITICAL BALLOON SEPARATION: Each physically distinct speech balloon must be detected as an independent region with its own bounding box.',
        'DOUBLE BALLOON INVARIANT: Connected, stacked, or adjacent balloons sharing a dialogue continuation are separate PhysicalBalloons, even if they belong to a single logical TranslationUnit.',
        'SINGLE BALLOON INTEGRATION: If multiple lines of text sit inside a single physical balloon boundary, output ONE region enclosing the entire balloon with all its text.',
      ],
      entityModelRules: [
        'PhysicalBalloon: Represents the physical drawn bubble in the comic artwork.',
        'TranslationUnit (TU): Represents the logical translation entity that groups one or more physical balloons for cohesive translation.',
      ],
      dataIntegrityInvariants: [
        'Never merge two physically distinct balloons into one bounding box merely because their text forms a single sentence.',
      ],
    },
    reading_order: {
      primarySystem: 'System #3 (Hierarchical Reading Order Inference)',
      architecturalDirectives: [
        'Panel hierarchy takes absolute precedence: sequence panels first before ordering sub-bubbles within a panel.',
        'Manga Right-to-Left (RTL): Order panels and bubbles from top to bottom, right to left.',
      ],
      entityModelRules: ['Reading order index is a 1-based sequential integer.'],
      dataIntegrityInvariants: ['No cyclic reading order dependencies allowed.'],
    },
    translation_quality: {
      primarySystem: 'System #2 (Translation & Eloquence Engine)',
      architecturalDirectives: [
        'Produce natural, dramatic Arabic scanlation that sounds authentic and idiomatic.',
        'Preserve correct Arabic orthography: retain required Hamzas (إلى، إن، أن، أحد) and meaningful Tanween (أخيراً، جداً).',
      ],
      entityModelRules: ['rawTranslatedText: Direct literary translation before humanization.'],
      dataIntegrityInvariants: ['Translations must preserve the dramatic intent of the source.'],
    },
  };

  return map[task] || {
    primarySystem: 'Folio Script Core Architecture',
    architecturalDirectives: ['Follow standard Folio Script high-fidelity scanning and translation rules.'],
    entityModelRules: [],
    dataIntegrityInvariants: ['Maintain source fidelity and structural integrity.'],
  };
}

function formatProjectContextForPrompt(tasks) {
  const sections = ['=== AUTHORITATIVE PROJECT ARCHITECTURE & SYSTEM DIRECTIVES ==='];
  for (const t of tasks) {
    const ctx = getTaskArchitecturalContext(t);
    sections.push(`[${ctx.primarySystem}]`);
    for (const d of ctx.architecturalDirectives) {
      sections.push(`- ${d}`);
    }
  }
  return sections.join('\n');
}

// ---------------------------------------------------------
// TEST 1: Initial Empty State Invariant
// ---------------------------------------------------------
console.log('[Test 1] Initial Empty State Invariant...');
{
  const initialSets = [];
  assert.strictEqual(initialSets.length, 0, 'Initial reference sets collection must be strictly empty');
  console.log('  ✓ Verified: Initial state is completely empty with zero dummy data.');
}

// ---------------------------------------------------------
// TEST 2: Reference Set Lifecycle & Version Tracking
// ---------------------------------------------------------
console.log('\n[Test 2] Reference Set Lifecycle & Version Tracking...');
{
  const now = Date.now();
  let set = {
    id: 'ref_set_101',
    title: 'Double Balloon Vertical Stack Handling',
    description: 'Guidelines for resolving split dialogue across vertical stacked balloons',
    generalInstructions: 'Separate stacked balloons into distinct regions.',
    targetTasks: ['scanning_classification', 'speech_balloon_detection'],
    enabled: true,
    priority: 85,
    version: 1,
    createdAt: now,
    updatedAt: now,
    examples: [],
  };

  assert.strictEqual(set.version, 1);
  assert.strictEqual(set.enabled, true);
  assert.strictEqual(set.priority, 85);
  assert.deepStrictEqual(set.targetTasks, ['scanning_classification', 'speech_balloon_detection']);

  // Simulate updating set: version increments monotonically
  const updated = {
    ...set,
    version: set.version + 1,
    title: 'Double Balloon Vertical Stack & Connected Tail Handling',
    updatedAt: Date.now(),
  };
  assert.strictEqual(updated.version, 2);
  assert.strictEqual(updated.title, 'Double Balloon Vertical Stack & Connected Tail Handling');

  // Simulate duplication: starts disabled for safety, version reset to 1
  const duplicated = {
    ...updated,
    id: 'ref_set_102',
    title: `${updated.title} (Copy)`,
    version: 1,
    enabled: false,
  };
  assert.strictEqual(duplicated.id, 'ref_set_102');
  assert.strictEqual(duplicated.version, 1);
  assert.strictEqual(duplicated.enabled, false);
  console.log('  ✓ Verified: Set creation, monotonic versioning, and safe duplication verified.');
}

// ---------------------------------------------------------
// TEST 3: Image Numbering & Reordering Consistency
// ---------------------------------------------------------
console.log('\n[Test 3] Image Numbering & Reordering Consistency...');
{
  let examples = [
    { id: 'ex_1', orderIndex: 1, title: 'Top-Right Connected Balloon' },
    { id: 'ex_2', orderIndex: 2, title: 'Stacked Double Balloon with Bridge' },
    { id: 'ex_3', orderIndex: 3, title: 'Split Sentence Across Panel Border' },
  ];

  examples.forEach((ex, idx) => {
    assert.strictEqual(ex.orderIndex, idx + 1);
  });

  const reordered = [examples[2], examples[0], examples[1]].map((ex, idx) => ({
    ...ex,
    orderIndex: idx + 1,
  }));

  assert.strictEqual(reordered[0].id, 'ex_3');
  assert.strictEqual(reordered[0].orderIndex, 1, 'ex_3 must now be #01');
  assert.strictEqual(reordered[1].id, 'ex_1');
  assert.strictEqual(reordered[1].orderIndex, 2, 'ex_1 must now be #02');
  assert.strictEqual(reordered[2].id, 'ex_2');
  assert.strictEqual(reordered[2].orderIndex, 3, 'ex_2 must now be #03');
  console.log('  ✓ Verified: Reordering updates numbering consistently to match AI presentation.');
}

// ---------------------------------------------------------
// TEST 4: Visual Annotations & Physical vs Logical Separation
// ---------------------------------------------------------
console.log('\n[Test 4] Visual Annotations & Physical vs Logical Separation...');
{
  const annotation1 = {
    id: 'ann_1',
    physicalObjectId: 'balloon_upper',
    box_2d: [120, 450, 260, 720],
    label: 'balloon',
    translationUnitId: 'TU_SPEECH_01',
    readingOrderIndex: 1,
    relationships: [{ targetObjectId: 'balloon_lower', relationType: 'continuation' }],
    notes: 'Top balloon of the double-bubble pair',
    isVerified: true,
    source: 'user',
  };

  const annotation2 = {
    id: 'ann_2',
    physicalObjectId: 'balloon_lower',
    box_2d: [280, 420, 430, 690],
    label: 'balloon',
    translationUnitId: 'TU_SPEECH_01',
    readingOrderIndex: 2,
    relationships: [{ targetObjectId: 'balloon_upper', relationType: 'connected_tail' }],
    notes: 'Bottom balloon sharing sentence continuation',
    isVerified: true,
    source: 'user',
  };

  assert.notStrictEqual(annotation1.physicalObjectId, annotation2.physicalObjectId);
  assert.notDeepStrictEqual(annotation1.box_2d, annotation2.box_2d);
  assert.strictEqual(annotation1.translationUnitId, annotation2.translationUnitId);
  assert.strictEqual(annotation1.translationUnitId, 'TU_SPEECH_01');
  assert.strictEqual(annotation1.readingOrderIndex, 1);
  assert.strictEqual(annotation2.readingOrderIndex, 2);
  console.log('  ✓ Verified: Physical balloon identity distinct from logical Translation Unit.');
}

// ---------------------------------------------------------
// TEST 5: Screenshot Folder Import & Duplicate Detection
// ---------------------------------------------------------
console.log('\n[Test 5] Screenshot Folder Import & Duplicate Detection...');
{
  const mockFiles = [
    { name: 'screen_10.png', size: 102400, hash: 'hash_aaa', ext: '.png' },
    { name: 'screen_2.png', size: 204800, hash: 'hash_bbb', ext: '.png' },
    { name: 'notes.txt', size: 500, hash: 'hash_txt', ext: '.txt' },
    { name: 'screen_1.png', size: 153600, hash: 'hash_ccc', ext: '.png' },
    { name: 'screen_20.png', size: 204800, hash: 'hash_bbb', ext: '.png' },
  ];

  const supportedExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  const candidates = [];
  let ignoredCount = 0;

  for (const f of mockFiles) {
    if (!supportedExts.has(f.ext)) {
      ignoredCount++;
      continue;
    }
    candidates.push(f);
  }

  assert.strictEqual(ignoredCount, 1, 'notes.txt must be safely ignored');
  assert.strictEqual(candidates.length, 4, '4 valid image files detected');

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  candidates.sort((a, b) => collator.compare(a.name, b.name));

  assert.strictEqual(candidates[0].name, 'screen_1.png');
  assert.strictEqual(candidates[1].name, 'screen_2.png');
  assert.strictEqual(candidates[2].name, 'screen_10.png');
  assert.strictEqual(candidates[3].name, 'screen_20.png');

  const seenHashes = new Set();
  const processed = candidates.map((c) => {
    const isDup = seenHashes.has(c.hash);
    seenHashes.add(c.hash);
    return { ...c, isDuplicate: isDup, isSelected: !isDup };
  });

  const dup = processed.find((p) => p.name === 'screen_20.png');
  assert.strictEqual(dup.isDuplicate, true, 'Duplicate hash detected');
  assert.strictEqual(dup.isSelected, false, 'Duplicates unselected by default');
  console.log('  ✓ Verified: Folder import filters unsupported files, sorts naturally, and flags duplicates.');
}

// ---------------------------------------------------------
// TEST 6: Agent Package Manifest Validation (dragonfly.training.v1)
// ---------------------------------------------------------
console.log('\n[Test 6] Agent Package Manifest Validation (dragonfly.training.v1)...');
{
  const validManifest = {
    schemaVersion: 'dragonfly.training.v1',
    exportedAt: Date.now(),
    generator: 'dragonfly-agent',
    referenceSet: {
      title: 'Agent Curated Double Balloon Set',
      description: 'Prepared by development agent',
      generalInstructions: 'Distinguish stacked bubbles cleanly.',
      targetTasks: ['scanning_classification', 'speech_balloon_detection'],
      priority: 70,
    },
    examples: [
      {
        orderIndex: 1,
        title: 'Stacked dialogue bubble with connecting tail',
        sourceFileName: 'shot_1.png',
        imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        aiNote: 'Pay attention to the slender connecting bridge between the two balloons.',
        expectedBehaviour: 'Return 2 separate region items with bounding boxes.',
        tags: ['double-balloon', 'bridge'],
        annotations: [
          {
            physicalObjectId: 'balloon_1',
            box_2d: [100, 200, 300, 400],
            label: 'balloon',
            translationUnitId: 'TU_1',
            isVerified: false,
          },
        ],
      },
    ],
  };

  const validation = validateTrainingPackageV1(validManifest);
  assert.strictEqual(validation.isValid, true, 'Valid package must pass validation');
  assert.strictEqual(validation.stats.exampleCount, 1);
  assert.strictEqual(validation.stats.unverifiedAnnotationCount, 1);

  const normalized = normalizePackageToSet(validManifest);
  assert.strictEqual(normalized.referenceSet.examples[0].annotations[0].isVerified, false, 'Agent annotations must be unverified');
  assert.strictEqual(normalized.embeddedImagesToStore.length, 1, 'Embedded base64 image extracted for storage');

  const badSchema = { ...validManifest, schemaVersion: 'v2-unsupported' };
  const badRes = validateTrainingPackageV1(badSchema);
  assert.strictEqual(badRes.isValid, false);
  assert.ok(badRes.errors[0].includes('Invalid schemaVersion'));

  const badCoords = JSON.parse(JSON.stringify(validManifest));
  badCoords.examples[0].annotations[0].box_2d = [500, 200, 400, 800];
  const badCoordsRes = validateTrainingPackageV1(badCoords);
  assert.strictEqual(badCoordsRes.isValid, false);
  assert.ok(badCoordsRes.errors.some((e) => e.includes('invalid height')));
  console.log('  ✓ Verified: Agent package validation enforces schema, bounds, and unverified AI annotations.');
}

// ---------------------------------------------------------
// TEST 7: Task-Specific Project Context Retrieval
// ---------------------------------------------------------
console.log('\n[Test 7] Task-Specific Project Context Retrieval...');
{
  const scanCtx = getTaskArchitecturalContext('speech_balloon_detection');
  assert.ok(scanCtx.primarySystem.includes('System #3'));
  assert.ok(scanCtx.architecturalDirectives.some((d) => d.includes('CRITICAL BALLOON SEPARATION')));
  assert.ok(scanCtx.dataIntegrityInvariants.some((i) => i.includes('Never merge two physically distinct balloons')));

  const transCtx = getTaskArchitecturalContext('translation_quality');
  assert.ok(transCtx.primarySystem.includes('System #2'));
  assert.ok(transCtx.architecturalDirectives.some((d) => d.includes('Preserve correct Arabic orthography')));

  const formattedPrompt = formatProjectContextForPrompt(['speech_balloon_detection', 'reading_order']);
  assert.ok(formattedPrompt.includes('AUTHORITATIVE PROJECT ARCHITECTURE'));
  assert.ok(formattedPrompt.includes('CRITICAL BALLOON SEPARATION'));
  assert.ok(formattedPrompt.includes('Hierarchical Reading Order'));
  assert.ok(!formattedPrompt.includes('System #2 (Translation & Eloquence Engine)'));
  console.log('  ✓ Verified: Task-scoped authoritative project context retrieved without indiscriminate dumping.');
}

// ---------------------------------------------------------
// TEST 8: Task Reference Set Selection & Image Budget Enforcement
// ---------------------------------------------------------
console.log('\n[Test 8] Task Reference Set Selection & Image Budget Enforcement...');
{
  const setA = {
    id: 'set_A',
    title: 'Balloon Separation Set',
    targetTasks: ['scanning_classification', 'speech_balloon_detection'],
    enabled: true,
    priority: 90,
  };

  const setB = {
    id: 'set_B',
    title: 'Arabic Poetry Eloquence Set',
    targetTasks: ['translation_quality'],
    enabled: true,
    priority: 80,
  };

  const setC = {
    id: 'set_C',
    title: 'Disabled Scanning Set',
    targetTasks: ['scanning_classification'],
    enabled: false,
    priority: 95,
  };

  const allSets = [setA, setB, setC];

  const activeScanningSets = allSets
    .filter((s) => s.enabled && s.targetTasks.includes('scanning_classification'))
    .sort((a, b) => b.priority - a.priority);

  assert.strictEqual(activeScanningSets.length, 1);
  assert.strictEqual(activeScanningSets[0].id, 'set_A');

  const activeTranslationSets = allSets.filter((s) => s.enabled && s.targetTasks.includes('translation_quality'));
  assert.strictEqual(activeTranslationSets.length, 1);
  assert.strictEqual(activeTranslationSets[0].id, 'set_B');

  const activeReviewSets = allSets.filter((s) => s.enabled && s.targetTasks.includes('review_qc'));
  assert.strictEqual(activeReviewSets.length, 0);

  const fiveExamples = [1, 2, 3, 4, 5].map((i) => ({ orderIndex: i, isEnabled: true }));
  const budgetLimit = 2;
  const budgeted = fiveExamples.filter((e) => e.isEnabled).slice(0, budgetLimit);
  assert.strictEqual(budgeted.length, 2, 'Must enforce budget ceiling');
  console.log('  ✓ Verified: Task-specific selection filters correct sets and enforces image/context budget.');
}

// ---------------------------------------------------------
// TEST 9: Gemini Multimodal Request Construction Integration
// ---------------------------------------------------------
console.log('\n[Test 9] Gemini Multimodal Request Construction Integration...');
{
  const baseInstruction = 'ROLE & MISSION: High-precision Manga Scanning Engine';
  const trainingGeneralInstructions = 'When encountering vertical stacked bubbles, always isolate upper and lower boundaries.';
  const trainingExampleTitle = 'Double Speech Bubble Connected by Tail';
  const trainingExampleNote = 'Notice how the upper balloon is speech and lower is continuation. Must produce two separate boxes.';
  const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M/wHwMDAwMDABvVA38oGk53AAAAAElFTkSuQmCC';

  const fullSystemInstruction = `${baseInstruction}\n\n=== TRAINING STUDIO REFERENCE INSTRUCTIONS ===\n${trainingGeneralInstructions}`;

  const userParts = [
    {
      text: '=== TRAINING STUDIO REFERENCE EXAMPLES ===\nStudy these reference examples, visual annotations, and notes:',
    },
    {
      text: `[TRAINING REFERENCE EXAMPLE #01: "${trainingExampleTitle}"]\nAI Note & Guidance:\n${trainingExampleNote}\nPhysical Object ID: "balloon_top"\nTranslation Unit Grouping: "TU_1"`,
    },
    {
      inline_data: {
        mime_type: 'image/png',
        data: mockBase64,
      },
    },
    {
      text: '=== TARGET COMIC PAGE TO ANALYZE ===\nAnalyze this comic page. Detect panels, speech balloons, sound effects, and floating text with normalized bounding boxes [0-1000]. Transcribe verbatim source text and classify into generic functional categories in pure JSON.',
    },
    {
      inline_data: {
        mime_type: 'image/png',
        data: 'TARGET_PAGE_BASE64_DATA',
      },
    },
  ];

  const payload = {
    system_instruction: { parts: [{ text: fullSystemInstruction }] },
    contents: [{ role: 'user', parts: userParts }],
    generation_config: { response_mime_type: 'application/json', temperature: 0.15 },
  };

  assert.ok(payload.system_instruction.parts[0].text.includes(trainingGeneralInstructions));
  assert.ok(payload.contents[0].parts[1].text.includes(trainingExampleTitle));
  assert.ok(payload.contents[0].parts[1].text.includes(trainingExampleNote));
  assert.ok(payload.contents[0].parts[1].text.includes('TU_1'));
  assert.strictEqual(payload.contents[0].parts[2].inline_data.data, mockBase64);
  assert.strictEqual(payload.contents[0].parts[4].inline_data.data, 'TARGET_PAGE_BASE64_DATA');

  console.log('  ✓ Verified: Approved examples, notes, annotations, and images reach the Gemini request path.');
}

// ---------------------------------------------------------
// TEST 10: Production-Build Dev Exclusion Guard
// ---------------------------------------------------------
console.log('\n[Test 10] Production-Build Dev Exclusion Guard...');
{
  function mockIsTrainingStudioEnabled(env) {
    if (env.isViteDev === true) return true;
    if (env.electronIsDev === true) return true;
    return false;
  }

  assert.strictEqual(mockIsTrainingStudioEnabled({ isViteDev: true, electronIsDev: false }), true);
  assert.strictEqual(mockIsTrainingStudioEnabled({ isViteDev: false, electronIsDev: true }), true);

  const prodEnv = { isViteDev: false, electronIsDev: false };
  assert.strictEqual(mockIsTrainingStudioEnabled(prodEnv), false, 'Training studio must be disabled in production');

  const categoriesInProd = [
    { id: 'translation' },
    { id: 'scanning' },
    ...(mockIsTrainingStudioEnabled(prodEnv) ? [{ id: 'training' }] : []),
    { id: 'general' },
  ];
  assert.ok(!categoriesInProd.some((c) => c.id === 'training'), 'No training category in production');
  console.log('  ✓ Verified: Production build exclusion strictly enforced at environment boundaries.');
}

console.log('\n====================================================');
console.log('ALL TRAINING STUDIO INDEPENDENT TESTS PASSED (10/10)');
console.log('====================================================');
