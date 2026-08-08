// Kenya-focused pronunciation lexicon for Soniox TTS.
// Maps surface forms → speakable forms. Longer / higher-priority matches win.

/**
 * @typedef {{ match: string, say: string, langs?: Array<'en'|'sw'|'sheng'>, priority?: number }} LexiconEntry
 * `match` is a case-insensitive regex source matched at word boundaries.
 */

/** @type {LexiconEntry[]} */
const KENYA_LEXICON = [
  // --- Brands / platforms (priority high) ---
  { match: 'whatsapp', say: 'WhatsApp', priority: 100 },
  { match: 'm-?pesa', say: 'M-Pesa', priority: 100 },
  { match: 'safaricom', say: 'Safaricom', priority: 100 },
  { match: 'airtel', say: 'Air-tel', priority: 100 },
  { match: 'ecitizen|e-citizen', say: 'e Citizen', priority: 100 },
  { match: 'nhif', say: 'N H I F', priority: 100 },
  { match: 'nssf', say: 'N S S F', priority: 100 },
  { match: 'kra', say: 'K R A', priority: 100 },
  { match: 'kcb', say: 'K C B', priority: 100 },
  { match: 'equity\\s+bank', say: 'Equity Bank', priority: 100 },
  { match: 'co-?op\\s+bank|cooperative\\s+bank', say: 'Co-op Bank', priority: 100 },
  { match: 'paybill', say: 'pay bill', priority: 90 },
  { match: 'till\\s+number', say: 'till number', priority: 90 },

  // --- Places / areas ---
  { match: 'ongata\\s+rongai', say: 'Ongata Rongai', priority: 95 },
  { match: 'athi\\s+river', say: 'Athi River', priority: 95 },
  { match: 'industrial\\s+area', say: 'Industrial Area', priority: 90 },
  { match: 'ruiru', say: 'Roo-ee-roo', priority: 90 },
  { match: 'thika', say: 'Thee-kah', priority: 90 },
  { match: 'kiambu', say: 'Kee-ahm-boo', priority: 90 },
  { match: 'westlands', say: 'West-lands', priority: 85 },
  { match: 'kilimani', say: 'Kee-lee-mah-nee', priority: 90 },
  { match: 'lavington', say: 'Lavington', priority: 85 },
  { match: 'parklands', say: 'Park-lands', priority: 85 },
  { match: 'eastleigh', say: 'East-lee', priority: 90 },
  { match: 'syokimau', say: 'Shyo-kee-mau', priority: 95 },
  { match: 'kitengela', say: 'Kee-ten-geh-la', priority: 95 },
  { match: 'limuru', say: 'Lee-moo-roo', priority: 90 },
  { match: 'juja', say: 'Joo-jah', priority: 90 },
  { match: 'ngong', say: 'Ngong', priority: 85 },
  { match: 'kabete', say: 'Kah-beh-teh', priority: 90 },
  { match: 'kasarani', say: 'Kah-sah-rah-nee', priority: 90 },
  { match: 'embakasi', say: 'Em-bah-kah-see', priority: 90 },
  { match: 'langata|lang\'ata', say: 'Lang-ah-ta', priority: 90 },
  { match: 'nairobi', say: 'Nairobi', priority: 80 },
  { match: 'mombasa', say: 'Mom-bah-sa', priority: 90 },
  { match: 'kisumu', say: 'Kee-soo-moo', priority: 90 },
  { match: 'nakuru', say: 'Nah-koo-roo', priority: 90 },
  { match: 'eldoret', say: 'El-do-ret', priority: 90 },
  { match: 'cbd', say: 'C B D', priority: 85 },

  // --- Service / trade terms ---
  { match: 'geyser', say: 'geezer', priority: 80 },
  { match: 'water\\s+heater', say: 'water heater', priority: 75 },
  { match: 'distribution\\s+board', say: 'distribution board', priority: 80 },
  { match: '\\bdb\\b', say: 'D B', priority: 70 },
  { match: '\\bwc\\b', say: 'W C', priority: 70 },
  { match: 'blocked\\s+drain', say: 'blocked drain', priority: 75 },
  { match: 'handyman', say: 'handy-man', priority: 75 },

  // --- Common abbreviations (all langs) ---
  { match: 'e\\.g\\.', say: 'for example', priority: 60 },
  { match: 'i\\.e\\.', say: 'that is', priority: 60 },
  { match: '\\bOK\\b', say: 'okay', priority: 60 },
  { match: '\\bhrs\\b', say: 'hours', priority: 60 },
  { match: '\\bapprox\\.?\\b', say: 'approximately', priority: 60 },
];

/**
 * @param {LexiconEntry[]} entries
 */
function compileEntries(entries) {
  return entries.map((entry, index) => {
    const source =
      entry.match.startsWith('\\b') || entry.match.includes('\\b')
        ? entry.match
        : `\\b(?:${entry.match})\\b`;
    return {
      ...entry,
      langs: entry.langs || ['en', 'sw', 'sheng'],
      priority: entry.priority ?? 50,
      index,
      re: new RegExp(source, 'gi'),
    };
  });
}

function sortCompiled(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return b.match.length - a.match.length || a.index - b.index;
}

/** Compiled once: highest priority first, then longer patterns. */
const COMPILED = compileEntries(KENYA_LEXICON).sort(sortCompiled);

/**
 * Parse tenant/env lexicon overrides.
 * Accepts JSON string or array of { match, say, langs?, priority? }.
 * @param {unknown} raw
 * @returns {LexiconEntry[]}
 */
function parseLexiconOverrides(raw) {
  if (raw == null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  /** @type {LexiconEntry[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const match = String(item.match || item.from || '').trim();
    const say = String(item.say || item.to || '').trim();
    if (!match || !say) continue;
    // Reject unsafe regex bombs / empty patterns.
    if (match.length > 80) continue;
    try {
      // Validate compile early.
      new RegExp(match.startsWith('\\b') ? match : `\\b(?:${match})\\b`, 'gi');
    } catch {
      continue;
    }
    out.push({
      match,
      say,
      langs: Array.isArray(item.langs) ? item.langs : ['en', 'sw', 'sheng'],
      priority: Number(item.priority) >= 0 ? Number(item.priority) : 200,
    });
  }
  return out;
}

function envLexiconOverrides() {
  return parseLexiconOverrides(process.env.TTS_LEXICON_OVERRIDES);
}

/**
 * Apply lexicon rewrites for the active TTS language.
 * @param {string} text
 * @param {'en'|'sw'|string} [lang]
 * @param {LexiconEntry[]} [extraEntries]
 */
function applyLexicon(text, lang = 'en', extraEntries = []) {
  let out = String(text || '');
  if (!out) return out;

  const ttsLang = lang === 'sw' ? 'sw' : 'en';
  const allowSheng = ttsLang === 'en';
  const extras = Array.isArray(extraEntries) ? extraEntries : [];
  const compiled =
    extras.length > 0
      ? [...compileEntries(extras), ...COMPILED].sort(sortCompiled)
      : COMPILED;

  for (const entry of compiled) {
    const ok =
      entry.langs.includes(ttsLang) ||
      (allowSheng && entry.langs.includes('sheng'));
    if (!ok) continue;
    out = out.replace(entry.re, entry.say);
  }

  return out;
}

function listLexiconEntries() {
  return KENYA_LEXICON.map(({ match, say, langs, priority }) => ({
    match,
    say,
    langs: langs || ['en', 'sw', 'sheng'],
    priority: priority ?? 50,
  }));
}

module.exports = {
  KENYA_LEXICON,
  applyLexicon,
  listLexiconEntries,
  parseLexiconOverrides,
  envLexiconOverrides,
};
