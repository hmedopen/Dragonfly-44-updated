import type { HumanizerRule, HumanizerIntensity } from '../types/workbench';

/**
 * ARABIC SCANLATION HUMANIZER RULEBOOK
 * Comprehensive structured definitions for the 16 linguistic rule groups.
 * Every rule has explicit restriction level, applicability, exceptions, and conflict behavior.
 */
export const ARABIC_HUMANIZER_RULES: HumanizerRule[] = [
  // 1. AI Sentence Patterns
  {
    id: 'rule-ai-01',
    category: 'ai_patterns',
    name: 'Antithesis Template Elimination',
    description: 'Avoid repetitive synthetic negative-then-positive formulas like "لم يكن... بل كان..." or "ليس فقط... وإنما...".',
    restrictionLevel: 'strict',
    applicability: 'all',
    detectionConditions: 'Presence of artificial antithesis pairs used to introduce obvious facts.',
    preferredBehavior: 'Use direct, punchy, narrative Arabic sentences.',
    exceptions: 'Permitted when the contrast is a dramatic narrative revelation deliberately emphasized.',
    badExample: 'لم تكن تلك الفتاة عادية، بل كانت ساحرة قوية.',
    goodExample: 'تلك الفتاة لم تكن عادية؛ إنها ساحرة مهيبة!',
    conflictBehavior: 'Yields if Master Prompt explicitly requests formal antithesis structure.',
  },
  {
    id: 'rule-ai-02',
    category: 'ai_patterns',
    name: 'Artificial Symmetrical Balance',
    description: 'Avoid mechanically balanced clauses joined with repeated coordinate conjunctions that sound synthetic.',
    restrictionLevel: 'moderate',
    applicability: 'dialogue',
    detectionConditions: 'Sentences divided into exactly two or three artificially symmetrical clauses.',
    preferredBehavior: 'Vary cadence naturally; spoken dialogue in manga is asymmetric and urgent.',
    exceptions: 'Poetic incantations, cultivation mantras, and formal announcements.',
    badExample: 'إما أن نقاتل فننتصر، وإما أن نستسلم فنهلك.',
    goodExample: 'قاتلوا وانتصروا، أو استسلموا للموت!',
    conflictBehavior: 'Yields to character voice requesting solemn or ritualistic symmetry.',
  },

  // 2. Connectors and Transitions
  {
    id: 'rule-conn-01',
    category: 'connectors',
    name: 'Explanatory Connector Spam',
    description: 'Eliminate overused AI transitional fillers such as "حيث", "إذ", "في حين أن", "من الجدير بالذكر".',
    restrictionLevel: 'strict',
    applicability: 'dialogue',
    detectionConditions: 'Casual dialogue bubbles starting with or joined by formal explanatory particles.',
    preferredBehavior: 'Connect thoughts through punctuation (، .. !) or conversational particles (فـ، ثم، لكن).',
    exceptions: 'Expository narration boxes and scholarly or detective analysis.',
    badExample: 'لن أذهب معك، حيث أنني متعب للغاية.',
    goodExample: 'لن أذهب معك، فأنا مرهق تماماً!',
    conflictBehavior: 'Master Prompt requests for academic or documentary tone take precedence.',
  },
  {
    id: 'rule-conn-02',
    category: 'connectors',
    name: 'Temporal Transition Clutter',
    description: 'Reduce repetitive AI transitional phrases like "وفي تلك الأثناء" or "وبينما كان يجري".',
    restrictionLevel: 'moderate',
    applicability: 'all',
    detectionConditions: 'Frequent narrative scene shifts using identical temporal boilerplate.',
    preferredBehavior: 'Use immediate action verbs and atmospheric brevity.',
    exceptions: 'Formal chapter transitions or explicit flashback markers.',
    badExample: 'وفي تلك الأثناء، كان القائد يعد خطته.',
    goodExample: 'في تلك اللحظة، كان القائد يحيك مكيدته.',
    conflictBehavior: 'Standard scanlation defaults apply unless overridden.',
  },

  // 3. Vocabulary Naturalness
  {
    id: 'rule-voc-01',
    category: 'vocabulary',
    name: 'Conversational vs Dictionary Diction',
    description: 'Replace stiff academic dictionary words with expressive, natural scanlation dialogue vocabulary.',
    restrictionLevel: 'moderate',
    applicability: 'dialogue',
    detectionConditions: 'Rare archaic lexical terms appearing in teenage or casual comic dialogue.',
    preferredBehavior: 'Use vibrant, idiomatic Arabic that human scanlators employ for dynamic manga flow.',
    exceptions: 'High Classical eloquence level (Level 3) or ancient martial masters/nobility.',
    badExample: 'يا صاح، إن تصرفاتك تُثير امتعاضي بشدة.',
    goodExample: 'أيها الوغد، تصرفاتك تثير اشمئزازي حقاً!',
    conflictBehavior: 'Eloquence Level 3 and Master Prompt override this rule.',
  },
  {
    id: 'rule-voc-02',
    category: 'vocabulary',
    name: 'Emotionally Attuned Synonyms',
    description: 'Select words that carry the precise emotional charge (fury, terror, affection, mockery) rather than neutral lemmas.',
    restrictionLevel: 'strict',
    applicability: 'dialogue',
    detectionConditions: 'Violent or intense visual scenes rendered with bland neutral verbs.',
    preferredBehavior: 'Match Arabic emotional intensity to the visual panel art.',
    exceptions: 'Emotionless robotic or stoic characters.',
    badExample: 'ابتعد وإلا سأقوم بضربك.',
    goodExample: 'ابتعد وإلا سحقت عظامك!',
    conflictBehavior: 'Character profile emotional tendencies take precedence.',
  },

  // 4. Sentence Structure
  {
    id: 'rule-struct-01',
    category: 'sentence_structure',
    name: 'Spoken Verbal Precedence',
    description: 'Prefer natural Arabic verbal sentence structures (verb before subject) in action and dialogue.',
    restrictionLevel: 'moderate',
    applicability: 'dialogue',
    detectionConditions: 'Consecutive nominal sentences ("أنا قلت...", "هو فعل...") when verbal flow is punchier.',
    preferredBehavior: 'Start with dynamic verbs unless emphasizing the subject or actor specifically.',
    exceptions: 'Strong emphasis on speaker identity ("أنا من سينهي هذا!").',
    badExample: 'أنا لا أستطيع أن أسمح لك بالمرور.',
    goodExample: 'لن أسمح لك بالمرور أبداً!',
    conflictBehavior: 'Yields to dialect structures where subject-first is idiomatic.',
  },

  // 5. Redundancy
  {
    id: 'rule-red-01',
    category: 'redundancy',
    name: 'Pruning Synthetic Restatement',
    description: 'Remove artificial restatement of obvious facts already conveyed by earlier words or panel art.',
    restrictionLevel: 'moderate',
    applicability: 'all',
    detectionConditions: 'A sentence that explains its own conclusion twice.',
    preferredBehavior: 'Maintain compact speech bubbles suitable for typesetting.',
    exceptions: 'Intentional comedic stuttering, panic repetition, or solemn emphasis.',
    badExample: 'لقد مات وانتهت حياته تماماً ولم يعد حياً.',
    goodExample: 'لقد هلك وانتهى أمره!',
    conflictBehavior: 'Deliberate repetition in source dialogue must be preserved.',
  },

  // 6. Dialogue Naturalness
  {
    id: 'rule-dial-01',
    category: 'dialogue_naturalness',
    name: 'Spoken Rhythm & Bubble Pacing',
    description: 'Ensure dialogue sounds believable when read aloud, formatted to fit comic bubble constraints.',
    restrictionLevel: 'strict',
    applicability: 'dialogue',
    detectionConditions: 'Bookish, convoluted syntax that cannot be spoken in a single breath.',
    preferredBehavior: 'Divide long lines naturally and preserve conversational momentum.',
    exceptions: 'Speeches delivered by politicians, professors, or grandiose villains.',
    badExample: 'هل يمكنك أن تتكرم بإخباري عن المكان الذي ذهب إليه رفاقنا في هذه الأمسية؟',
    goodExample: 'أخبرني، إلى أين ذهب رفاقنا الليلة؟',
    conflictBehavior: 'Master Prompt style instructions prevail.',
  },

  // 7. Narration Naturalness
  {
    id: 'rule-narr-01',
    category: 'narration_naturalness',
    name: 'Atmospheric Narration Flow',
    description: 'Provide smooth, literary Arabic narration without artificial embellishment or machine stiffness.',
    restrictionLevel: 'moderate',
    applicability: 'narration',
    detectionConditions: 'Narrative caption boxes bloated with unnecessary explanatory filler.',
    preferredBehavior: 'Use evocative, concise prose matching the dark, tense, or comedic mood.',
    exceptions: 'Cultivation lore encyclopedic boxes where full technical detail is required.',
    badExample: 'في ذلك المكان المظلم، كانت هناك قوى غامضة تتحرك بدون معرفة أحد.',
    goodExample: 'في غياهب تلك الظلمة، تحركت قوى مجهولة في الخفاء.',
    conflictBehavior: 'Genre directives guide narrative register.',
  },

  // 8. Emotional Expression
  {
    id: 'rule-emo-01',
    category: 'emotional_expression',
    name: 'Intensity & Insult Fidelity',
    description: 'Preserve insults, threats, sarcasm, and screams at their authentic intensity without sanitization.',
    restrictionLevel: 'strict',
    applicability: 'dialogue',
    detectionConditions: 'Fierce combat screams or vulgar taunts toned down into polite formal speech.',
    preferredBehavior: 'Deliver stinging, culturally authentic Arabic threats and battle cries.',
    exceptions: 'None. Sarcasm and anger must never be neutered.',
    badExample: 'أيها الشخص السيئ، سأعاقبك بشدة.',
    goodExample: 'أيها الحثالة، سأريك الجحيم بأم عينيك!',
    conflictBehavior: 'Strict priority across all modes.',
  },

  // 9. Grammar and Agreement
  {
    id: 'rule-gram-01',
    category: 'grammar_agreement',
    name: 'Strict Gender & Number Concord',
    description: 'Enforce flawless Arabic verb, pronoun, and adjective agreement matching the character artwork.',
    restrictionLevel: 'strict',
    applicability: 'all',
    detectionConditions: 'Addressing a female character with masculine verbs (e.g. أنتَ instead of أنتِ, ذهبتَ instead of ذهبتِ).',
    preferredBehavior: 'Accurate grammatical concord informed by artwork and Chapter Intelligence roster.',
    exceptions: 'Deliberate cross-dressing or disguised identity plot points.',
    badExample: 'يا آنسة، هل أنتَ مستعد؟',
    goodExample: 'يا آنسة، هل أنتِ مستعدة؟',
    conflictBehavior: 'Cannot be overridden by style presets unless deliberate narrative deceit.',
  },

  // 10. Punctuation
  {
    id: 'rule-punc-01',
    category: 'punctuation',
    name: 'Comic Bubble Punctuation Standards',
    description: 'Normalize em-dashes (—) to double periods (..) or commas, and bookish semicolons (؛) to commas (،).',
    restrictionLevel: 'light',
    applicability: 'all',
    detectionConditions: 'Academic semicolons, English hyphens, or multiple consecutive commas.',
    preferredBehavior: 'Clean, legible scanlation punctuation with correct spacing.',
    exceptions: 'Preserve intentional ellipses (...), question-exclamations (!?), and pauses.',
    badExample: 'توقف—لا تتقدم؛ هناك خطر..،',
    goodExample: 'توقف.. لا تتقدم، هناك خطر!',
    conflictBehavior: 'Safe formatting polish; preserves source pauses.',
  },

  // 11. Hamza and Orthography
  {
    id: 'rule-ortho-01',
    category: 'hamza_orthography',
    name: 'Preservation of Legitimate Hamzas',
    description: 'Preserve correct Arabic hamza distinctions (أ، إ، آ، ؤ، ئ) on all vocabulary. Never strip into misspellings.',
    restrictionLevel: 'strict',
    applicability: 'all',
    detectionConditions: 'Blind replacement of "إلى" with "الى", "إن" with "ان", "أحد" with "احد", etc.',
    preferredBehavior: 'Retain standard Arabic orthography. Quality scanlations respect correct spelling.',
    exceptions: 'Explicitly requested dialect phonetic spelling where hamza drops colloquially (e.g., إيش -> ايش).',
    badExample: 'ذهب الى البيت وقال انه احد الابطال.',
    goodExample: 'ذهب إلى البيت وقال إنه أحد الأبطال.',
    conflictBehavior: 'Master Prompt dialect requests take precedence; otherwise correct spelling is enforced.',
  },

  // 12. Diacritics and Tanween
  {
    id: 'rule-diac-01',
    category: 'diacritics_tanween',
    name: 'Contextual Tanween & Shadda Preservation',
    description: 'Retain tanween on essential adverbs (أبداً، شكراً، حقاً، معاً) and shadda (ّ) where meaning is disambiguated.',
    restrictionLevel: 'moderate',
    applicability: 'all',
    detectionConditions: 'Total removal of tanween from common adverbial endings or removing critical shaddas.',
    preferredBehavior: 'Clean text without heavy vocalization, while keeping indispensable tanween on adverbs.',
    exceptions: 'Casual dialogue bubbles where typesetter prefers completely unvocalized text.',
    badExample: 'شكرا جزيلا، لن انسى هذا ابدا.',
    goodExample: 'شكراً جزيلاً، لن أنسى هذا أبداً!',
    conflictBehavior: 'Orthography mode controls default tanween policy.',
  },

  // 13. Repetition and Rhythm
  {
    id: 'rule-rhythm-01',
    category: 'repetition_rhythm',
    name: 'Deliberate Repetition Protection',
    description: 'Do not automatically synonymize or eliminate repeated words when repetition is intentional for emphasis.',
    restrictionLevel: 'context_dependent',
    applicability: 'dialogue',
    detectionConditions: 'Repeated words used for frantic shouting or despair ("مستحيل.. مستحيل!").',
    preferredBehavior: 'Preserve intentional dramatic rhythm and desperate chants.',
    exceptions: 'Accidental machine duplication of entire clauses.',
    badExample: 'مستحيل.. غير ممكن!',
    goodExample: 'مستحيل.. مستحيل!',
    conflictBehavior: 'Master Prompt and source text repetition override synonymizer.',
  },

  // 14. Idioms and Expressions
  {
    id: 'rule-idiom-01',
    category: 'idioms_expressions',
    name: 'Non-Literal Idiomatic Localization',
    description: 'Detect source culture idioms (Japanese/Korean/Chinese/English) and render natural Arabic scanlation equivalents.',
    restrictionLevel: 'strict',
    applicability: 'all',
    detectionConditions: 'Word-for-word translation of idioms that produces incomprehensible Arabic.',
    preferredBehavior: 'Translate the communicative intent into natural Arabic idioms.',
    exceptions: 'Specific martial arts technique names and fantasy skill lore (keep verified terms).',
    badExample: 'إنه يسحب رجلي (It is pulling my leg).',
    goodExample: 'إنه يسخر مني ويمزح معي!',
    conflictBehavior: 'Project Lore and Master Prompt glossary rules prevail.',
  },

  // 15. Dialect Preservation
  {
    id: 'rule-dialect-01',
    category: 'dialect_preservation',
    name: 'Regional Dialect Integrity (Algerian, Egyptian, Levantine, etc.)',
    description: 'When a regional dialect is explicitly instructed by the user, strictly preserve dialect grammar, negation, and lexicon.',
    restrictionLevel: 'strict',
    applicability: 'dialect',
    detectionConditions: 'User specifies dialect in Master Prompt (e.g. "اللهجة الجزائرية", "دارجة").',
    preferredBehavior: 'Deliver authentic regional expressions (e.g., Algerian: واش، كاش، برك، ما علاباليش، بزاف). Never normalize into MSA.',
    exceptions: 'Do not apply dialect unless explicitly instructed by the user or project settings.',
    badExample: 'Master Prompt asks for Algerian Arabic, but engine translates: "ماذا تفعل الآن؟"',
    goodExample: 'Engine follows Master Prompt: "واش راك دير درك؟"',
    conflictBehavior: 'HIGHEST PRIORITY. Overrides standard MSA humanizer rules and eloquence presets.',
  },

  // 16. Character Voice
  {
    id: 'rule-char-01',
    category: 'character_voice',
    name: 'Personality & Idiolect Protection',
    description: 'Do not homogenize dialogue. Characters with rough speech, stuttering, royal majesty, or eccentric quirks must retain them.',
    restrictionLevel: 'strict',
    applicability: 'dialogue',
    detectionConditions: 'All characters in a scene sounding identically articulate and polite.',
    preferredBehavior: 'Reflect character profiles and relationship tones consistently.',
    exceptions: 'Background unnamed extras without defined voice.',
    badExample: 'A ruthless street thug speaking in formal diplomatic phrasing.',
    goodExample: 'Street thug: "أيها الوغد.. سأسحق رأسك إن نطقت بحرف!"',
    conflictBehavior: 'Master Prompt character directives strictly override generic presets.',
  },
];

/**
 * Filter rules applicable to a specific generation request based on intensity and dialect status.
 */
export function getApplicableHumanizerRules(options: {
  intensity: HumanizerIntensity;
  isDialectActive?: boolean;
  textType?: 'dialogue' | 'narration' | 'all';
}): HumanizerRule[] {
  const { intensity, isDialectActive = false, textType = 'all' } = options;

  return ARABIC_HUMANIZER_RULES.filter((rule) => {
    // 1. If dialect is active, suppress rules that would force MSA vocabulary or syntax
    if (isDialectActive) {
      if (rule.category === 'vocabulary' && rule.id === 'rule-voc-01') return false;
      if (rule.category === 'sentence_structure' && rule.id === 'rule-struct-01') return false;
      if (rule.id === 'rule-conn-01') return false;
    }

    // 2. Filter by text applicability
    if (textType !== 'all') {
      if (rule.applicability !== 'all' && rule.applicability !== textType) {
        if (!(isDialectActive && rule.applicability === 'dialect')) {
          return false;
        }
      }
    }

    // 3. Filter by restriction level according to configured intensity
    switch (intensity) {
      case 'light':
        return rule.restrictionLevel === 'strict';
      case 'balanced':
        return rule.restrictionLevel === 'strict' || rule.restrictionLevel === 'moderate';
      case 'strong':
        return rule.restrictionLevel === 'strict' || rule.restrictionLevel === 'moderate' || rule.restrictionLevel === 'light';
      case 'maximum':
        return true; // Apply all levels including context-dependent
      default:
        return rule.restrictionLevel === 'strict' || rule.restrictionLevel === 'moderate';
    }
  });
}

/**
 * Compiles applicable humanizer rules into clean, high-precision prompt directives.
 */
export function compileHumanizerPromptDirectives(options: {
  intensity?: HumanizerIntensity;
  isDialectActive?: boolean;
  textType?: 'dialogue' | 'narration' | 'all';
  masterPromptOverride?: string;
}): string {
  const {
    intensity = 'balanced',
    isDialectActive = false,
    textType = 'all',
  } = options;

  const rules = getApplicableHumanizerRules({ intensity, isDialectActive, textType });

  const ruleLines = rules.map((r, idx) => {
    const exc = r.exceptions ? ` (Exceptions: ${r.exceptions})` : '';
    return `${idx + 1}. [${r.name}]: ${r.preferredBehavior}${exc}`;
  });

  const dialectNote = isDialectActive
    ? '\nSPECIAL DIALECT DIRECTIVE: User requested regional dialect. Strictly maintain authentic colloquial expressions, vocabulary, and grammar. Never normalize into Modern Standard Arabic.'
    : '';

  return `ARABIC SCANLATION HUMANIZER & NATURAL CADENCE DIRECTIVES:
Intensity Profile: [${intensity.toUpperCase()}]
${ruleLines.join('\n')}${dialectNote}`.trim();
}
