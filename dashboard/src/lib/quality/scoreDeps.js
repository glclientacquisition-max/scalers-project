/* eslint-disable @typescript-eslint/no-require-imports */
// Dependencies of the phase 1 voice score, copied so the desk can score
// traces without loading the voice engine. Source of truth stays
// src/conversation/language.js (analyzeCallerLanguage) and
// src/speech/turnTaking.js (utteranceLooksIncomplete) at main 4fb3df5d,
// which is what Voice PR #582 voiceScore.js calls.

const SWAHILI_MARKERS = [
  'habari',
  'sasa',
  'sawa',
  'asante',
  'tafadhali',
  'ninaomba',
  'nataka',
  'ningependa',
  'naomba',
  'karibu',
  'pole',
  'samahani',
  'ndiyo',
  'hapana',
  'kwaheri',
  'jina',
  'bei',
  'huduma',
  'leo',
  'kesho',
  'saa',
  'wapi',
  'gani',
  'nina',
  'nime',
  'tuko',
  'unaweza',
  'naweza',
  'nitakupigia',
  'nakucheckia',
  'nakuangalia',
  'shida',
  'msaada',
  'bei gani',
  'nina hitaji',
  'nataka msaada',
  'kusafisha',
  'nisaidie',
  'njoo',
  'kuja',
  'ako',
  'siku',
];

const SHENG_MARKERS = [
  'niaje',
  'maze',
  'msee',
  'manze',
  'poa sana',
  'niko poa',
  'nko poa',
  'faro',
  'soft life',
  'nimechill',
  'nimebamba',
  'tuko spot',
  'udae',
  'msee wangu',
];

const ENGLISH_CORE_MARKERS = [
  'hello',
  'hi',
  'hey',
  'thanks',
  'thank you',
  'please',
  'need',
  'want',
  'looking for',
  'how much',
  'my name',
  'i am',
  "i'm",
  'can you',
  'could you',
  'what do you',
  'do you offer',
  'call me',
  'call back',
  'yes',
  'no',
  'okay',
  'ok',
];

/** English job nouns Kenyans keep inside Kiswahili. Do not treat as English. */
const ENGLISH_JOB_LOANWORDS = [
  'cleaning',
  'plumber',
  'plumbing',
  'electrical',
  'appointment',
  'booking',
  'service',
  'services',
  'price',
  'cost',
  'available',
  'carpet',
  'couch',
  'mattress',
  'sofa',
  'airbnb',
  'visit',
  'emergency',
];

function markerAppears(raw, marker) {
  const escaped = String(marker)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
    raw
  );
}

function countMarkers(raw, markers) {
  return markers.reduce(
    (count, marker) => count + (markerAppears(raw, marker) ? 1 : 0),
    0
  );
}

/**
 * Evidence-bearing detection for stateful language policy.
 * @param {string} text
 */
function analyzeCallerLanguage(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return {
      language: 'unknown',
      confidence: 0,
      scores: { en: 0, sw: 0, sheng: 0 },
    };
  }

  let swHits = countMarkers(raw, SWAHILI_MARKERS);
  let enHits = countMarkers(raw, ENGLISH_CORE_MARKERS);
  const loanHits = countMarkers(raw, ENGLISH_JOB_LOANWORDS);
  const shengHits = countMarkers(raw, SHENG_MARKERS);
  if (swHits === 0) enHits += loanHits;

  if (
    !swHits &&
    !shengHits &&
    /\b(i|my|you|we|the|a|an|is|are|can|do|what|how|when|where)\b/.test(raw)
  ) {
    enHits += 2;
  }

  let language = 'unknown';
  if (shengHits >= 2 && shengHits >= swHits && shengHits >= enHits) {
    language = 'sheng';
  } else if (swHits === 0 && enHits === 0) {
    language = 'unknown';
  } else if (swHits > 0 && enHits > 0) {
    if (swHits >= enHits + 2) language = 'sw';
    else if (enHits >= swHits + 2) language = 'en';
    else language = 'mixed';
  } else {
    language = swHits > enHits ? 'sw' : 'en';
  }

  const scores = { en: enHits, sw: swHits, sheng: shengHits };
  const ranked = Object.values(scores).sort((a, b) => b - a);
  const top = ranked[0] || 0;
  const margin = top - (ranked[1] || 0);
  const confidence =
    language === 'unknown'
      ? 0
      : language === 'mixed'
        ? 0.55
        : Math.min(0.98, top === 1 ? 0.58 : 0.55 + top * 0.12 + margin * 0.08);
  return { language, confidence, scores };
}

const INCOMPLETE_TAIL =
  /\b(and|but|so|because|or|then|also|with|for|to|na|lakini|kwa|sababu|ama|halafu|then)\s*$/i;


const LET_ME_THINK_RE =
  /^(?:(?:please\s+)?(?:let me think|let me see|i need to think|i'?m thinking)(?:\s+about(?:\s+it)?)?|hold that thought)$/i;


function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function utteranceLooksIncomplete(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;

  // Live call HD_0cdf315f02e9: "executive room,and." was flushed mid-thought.
  // Trailing comma or dash means the caller has not finished the phrase.
  if (/[,—–-]\s*$/.test(raw)) return true;

  const core = raw.replace(/[.!?,;:…—–-]+$/g, '').trim();
  if (!core) return false;

  if (INCOMPLETE_TAIL.test(core) || INCOMPLETE_TAIL.test(raw)) return true;
  // Open Kiswahili frame: the object is still missing.
  // "Nilikuwa nataka kujua." / "Nilikuwa nauliza," must wait, not flush as a goal.
  if (
    /\b(?:nilikuwa(?:\s+(?:nauliza|nataka|ningetaka|ningependa|naomba))?|nauliza|ningetaka|ningependa|naomba|nataka)(?:\s+(?:kujua|kuuliza))?\s*$/i.test(
      core
    )
  ) {
    return true;
  }
  if (/\b(?:um+|uh+|ah+)\s*$/i.test(core)) return true;
  // Trailing comma / "and," without finishing the clause.
  if (/,\s*(and|but|so|or)?$/i.test(core)) return true;
  // "my name is" / "jina langu ni" without the name yet.
  if (/\b(my name is|i am|i'm|jina langu ni|ninaitwa)\s*$/i.test(core)) return true;
  // Mid-thought cutoffs common on live Kenyan calls (HD_02bda14e6547).
  if (
    /\b(i want to|i'd like to|i would like to|ningetaka|naomba|can you tell|you can tell)\s*$/i.test(
      core
    )
  ) {
    return true;
  }
  if (/\b(that i'm|that i am|tell him that|tell her that)\s*$/i.test(core)) {
    return true;
  }
  const norm = normalizeSpeech(core);
  if (LET_ME_THINK_RE.test(norm)) return true;
  if (/\b(let me think|i('m| am) thinking)\s*$/i.test(core)) return true;
  if (/^(actually|i said)$/i.test(norm)) return true;
  if (/\b(actually|i said)\s*$/i.test(core)) return true;
  return false;
}


module.exports = {
  analyzeCallerLanguage,
  utteranceLooksIncomplete,
};
