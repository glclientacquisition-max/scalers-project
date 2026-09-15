// Canonical caller-name spelling for live capture and post-call save.
// STT variants fold onto a known file name or a Kenya given-name table.
// Speak/save the canonical form so the TTS lexicon can pronounce it.
// Do not invent names. Do not write free-form names into the TTS lexicon.

function compactNameKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z]/g, '');
}

function titleCaseWord(value) {
  const lower = String(value || '').toLowerCase();
  if (!lower) return '';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function maxEditDistance(heardKey, candidateKey) {
  const minLen = Math.min(heardKey.length, candidateKey.length);
  if (minLen >= 7) return 2;
  if (minLen >= 4) return 1;
  return 0;
}

function fuzzyScore(heardKey, candidateKey) {
  if (!heardKey || !candidateKey) return 0;
  if (heardKey === candidateKey) return 100;
  const distance = levenshtein(heardKey, candidateKey);
  if (distance > maxEditDistance(heardKey, candidateKey)) return 0;
  return distance === 1 ? 85 : 70;
}

/**
 * Kenya given names that STT commonly mangles.
 * Aliases are heard forms only. Asha is not an alias of Aisha.
 * Canonical spellings match the TTS lexicon where one exists (Aisha, Wanjiku, …).
 */
const KENYA_GIVEN_NAMES = [
  {
    canonical: 'Aisha',
    aliases: ['eisha', 'isha', 'aiesha', 'aysha', 'eysha', 'eyesha', 'aicha', 'aisa', 'aesha'],
  },
  { canonical: 'Asha', aliases: [] },
  { canonical: 'Wanjiku', aliases: ['wanjiko', 'wanjikoo', 'wanjiiku', 'wanjeku'] },
  { canonical: 'Wambui', aliases: ['wamboy', 'wambuy', 'wambooi'] },
  { canonical: 'Njeri', aliases: ['njeree', 'njery', 'ngeri'] },
  { canonical: 'Otieno', aliases: ['oteino', 'otienoh'] },
  { canonical: 'Ochieng', aliases: ['ocheng', 'ochiengh'] },
  { canonical: 'Kamau', aliases: ['kamaw', 'kamao'] },
  { canonical: 'Mwangi', aliases: ['mwangii', 'mwange'] },
  { canonical: 'Wanjiru', aliases: ['wanjiro', 'wanjero'] },
  { canonical: 'Nyambura', aliases: ['nyamura'] },
  { canonical: 'Amina', aliases: ['ameena', 'aminah', 'ameenah'] },
  { canonical: 'Atieno', aliases: ['ateino'] },
  { canonical: 'Akinyi', aliases: ['akini'] },
  { canonical: 'Adhiambo', aliases: ['adiambo'] },
  { canonical: 'Omondi', aliases: ['omonde'] },
  { canonical: 'Onyango', aliases: [] },
  { canonical: 'Odhiambo', aliases: ['odiambo'] },
  { canonical: 'Njoroge', aliases: ['njoronge', 'joroge'] },
  { canonical: 'Kipchoge', aliases: ['kipchogeh'] },
  { canonical: 'Chebet', aliases: ['chebett'] },
  { canonical: 'Fatuma', aliases: ['fatma', 'fathuma', 'fatmah'] },
  { canonical: 'Hassan', aliases: ['hasan', 'hassaan'] },
  { canonical: 'Juma', aliases: [] },
  { canonical: 'Baraka', aliases: [] },
];

function kenyaRows() {
  return KENYA_GIVEN_NAMES.map((row) => ({
    canonical: row.canonical,
    key: compactNameKey(row.canonical),
    aliases: new Set((row.aliases || []).map((alias) => compactNameKey(alias))),
  }));
}

const KENYA_ROWS = kenyaRows();

/**
 * Two real names STT often swaps. Never silent-rewrite one to the other.
 * Ask once, or keep a returning-file spelling on a near miss.
 */
const NAME_COLLISION_GROUPS = [
  ['Colin', 'Collins'],
  ['Brian', 'Bryan'],
  ['John', 'Jon'],
  ['Ann', 'Anne'],
  ['Sara', 'Sarah'],
  ['Philip', 'Phillip'],
  ['Stephen', 'Steven'],
  ['Catherine', 'Katherine'],
];

function collisionGroupFor(name) {
  const key = compactNameKey(name);
  if (!key) return null;
  for (const group of NAME_COLLISION_GROUPS) {
    if (group.some((option) => compactNameKey(option) === key)) {
      return [...group];
    }
  }
  return null;
}

function sameCollisionGroup(a, b) {
  const left = compactNameKey(a);
  const right = compactNameKey(b);
  if (!left || !right) return false;
  const group = collisionGroupFor(a);
  if (!group) return false;
  return group.some((option) => compactNameKey(option) === right);
}

function pairMember(name, group) {
  const key = compactNameKey(name);
  if (!key || !Array.isArray(group)) return null;
  return group.find((option) => compactNameKey(option) === key) || null;
}

/**
 * Caller picked one side of a collision or spelled it.
 */
function pickCollisionChoice(text, group) {
  if (!Array.isArray(group) || !group.length) return null;
  const spelled = parseSpelledCallerName(text);
  if (spelled) {
    const fromSpelling = pairMember(spelled, group);
    if (fromSpelling) return fromSpelling;
  }
  const raw = String(text || '');
  let hit = null;
  for (const option of group) {
    const re = new RegExp(`\\b${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!re.test(raw)) continue;
    if (!hit || option.length > hit.length) hit = option;
  }
  return hit;
}

function scoreKenyaRow(heardKey, row) {
  if (!heardKey) return 0;
  if (heardKey === row.key) return 100;
  if (row.aliases.has(heardKey)) return 95;
  return fuzzyScore(heardKey, row.key);
}

function bestKenyaMatch(heard) {
  const heardKey = compactNameKey(heard);
  if (!heardKey) return null;
  let best = null;
  for (const row of KENYA_ROWS) {
    const score = scoreKenyaRow(heardKey, row);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        canonical: row.canonical,
        source: 'kenya',
        score,
        matched: heard,
      };
    }
  }
  return best;
}

function bestKnownMatch(heard, knownNames = []) {
  const heardKey = compactNameKey(heard);
  if (!heardKey) return null;
  let best = null;
  for (const row of Array.isArray(knownNames) ? knownNames : []) {
    const name = String(row?.name || row || '').trim();
    const key = compactNameKey(name);
    if (!key) continue;
    const collision = sameCollisionGroup(heardKey, key) ? 90 : 0;
    const score = Math.max(fuzzyScore(heardKey, key), collision);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        canonical: name,
        source: row?.source || 'known',
        score,
        matched: heard,
      };
    }
  }
  return best;
}

/**
 * Letter-by-letter spelling from the utterance (A I S H A / A-I-S-H-A).
 * Requires 3+ consecutive single letters.
 */
function parseSpelledCallerName(text) {
  const tokens = String(text || '')
    .replace(/[?.!]+/g, ' ')
    .split(/[\s,.-]+/)
    .filter(Boolean);
  let run = [];
  const sequences = [];
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      run.push(token.toLowerCase());
    } else {
      if (run.length >= 3) sequences.push(run.join(''));
      run = [];
    }
  }
  if (run.length >= 3) sequences.push(run.join(''));
  if (!sequences.length) return null;
  return titleCaseWord(sequences[0]);
}

/**
 * @param {string} heard
 * @param {{ knownNames?: Array<{name:string, source?: string}|string>, preferKnown?: boolean }} [opts]
 * @returns {{ canonical: string, source: string, score: number, matched: string } | null}
 */
function matchCallerName(heard, opts = {}) {
  const raw = String(heard || '').trim();
  if (!raw) return null;
  const preferKnown = opts.preferKnown !== false;
  const knownHit = bestKnownMatch(raw, opts.knownNames);
  const kenyaHit = bestKenyaMatch(raw);

  if (preferKnown && knownHit && knownHit.score >= 85) return knownHit;
  if (knownHit && kenyaHit) {
    return knownHit.score >= kenyaHit.score ? knownHit : kenyaHit;
  }
  return knownHit || kenyaHit || null;
}

function canonicalizeCallerName(heard, opts = {}) {
  const raw = String(heard || '').trim();
  if (!raw) return null;
  const hit = matchCallerName(raw, opts);
  return hit ? hit.canonical : raw;
}

/**
 * Same person, not a new household name.
 * Exact compact, or both fold to the same Kenya canonical. No free-form Levenshtein.
 */
function namesLikelySame(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (compactNameKey(left) === compactNameKey(right)) return true;
  const leftKenya = bestKenyaMatch(left);
  const rightKenya = bestKenyaMatch(right);
  if (
    leftKenya &&
    rightKenya &&
    compactNameKey(leftKenya.canonical) === compactNameKey(rightKenya.canonical)
  ) {
    return true;
  }
  if (leftKenya && compactNameKey(leftKenya.canonical) === compactNameKey(right)) {
    return true;
  }
  if (rightKenya && compactNameKey(rightKenya.canonical) === compactNameKey(left)) {
    return true;
  }
  return sameCollisionGroup(left, right);
}

function preferredContactSpelling(primary, incoming) {
  const kenyaIncoming = bestKenyaMatch(incoming);
  if (kenyaIncoming) return kenyaIncoming.canonical;
  const kenyaPrimary = bestKenyaMatch(primary);
  if (kenyaPrimary) return kenyaPrimary.canonical;
  if (primary && incoming && sameCollisionGroup(primary, incoming)) {
    return String(primary).trim();
  }
  return String(primary || incoming || '').trim() || null;
}

function collectKnownCallerNames({ profile = null, state = null } = {}) {
  const names = [];
  const seen = new Set();
  function push(name, source) {
    const value = String(name || '').trim();
    if (!value) return;
    const key = compactNameKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push({ name: value, source });
  }
  const card = profile?.callerMemory;
  if (card?.name) push(card.name, card.greetByName ? 'memory' : 'file');
  for (const alt of card?.alternateNames || []) push(alt, 'alternate');
  push(state?.caller?.name, 'state');
  return names;
}

module.exports = {
  KENYA_GIVEN_NAMES,
  NAME_COLLISION_GROUPS,
  compactNameKey,
  parseSpelledCallerName,
  matchCallerName,
  canonicalizeCallerName,
  namesLikelySame,
  preferredContactSpelling,
  collectKnownCallerNames,
  collisionGroupFor,
  sameCollisionGroup,
  pickCollisionChoice,
};
