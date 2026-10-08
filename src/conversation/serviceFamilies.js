// Spoken service families for a long catalogue. Derived from the names and
// categories on file, never from one tenant: rows that share a content word
// (or a category) become one family, named from what they have in common.
//   1-Bedroom Apartment, 2-Bedroom Apartment, 3-Bedroom House
//     -> "apartment and house cleaning"
//   Small Office, Medium Office -> "office cleaning"
// No dictionary. The only fixed words are activity words (clean, wash,
// repair) and size or package words that never name a service on their own.

const ACTIVITY = new Map([
  ['clean', 'cleaning'],
  ['cleaning', 'cleaning'],
  ['cleans', 'cleaning'],
  ['cleaner', 'cleaning'],
  ['wash', 'washing'],
  ['washing', 'washing'],
  ['repair', 'repair'],
  ['repairs', 'repair'],
  ['service', ''],
  ['services', ''],
  ['servicing', 'servicing'],
  ['installation', 'installation'],
  ['install', 'installation'],
]);

const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'up', 'with', 'in', 'out', 'on', 'per', 'by',
  'standard', 'basic', 'premium', 'regular', 'special', 'custom', 'full', 'general',
  'small', 'medium', 'large', 'mini', 'big', 'extra', 'plus', 'add',
  'package', 'packages', 'contract', 'unit', 'units', 'visit', 'job', 'flat', 'rate',
  'internal', 'interior', 'exterior', 'external',
]);

function displayName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOf(name) {
  return displayName(name)
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function contentWords(name) {
  return wordsOf(name).filter((w) => w.length > 2 && !FILLER.has(w) && !ACTIVITY.has(w));
}

function catalogueActivity(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const w of wordsOf(row.name)) {
      const act = ACTIVITY.get(w);
      if (act) counts.set(act, (counts.get(act) || 0) + 1);
    }
  }
  let best = '';
  let top = 0;
  for (const [act, n] of counts) {
    if (n > top) {
      best = act;
      top = n;
    }
  }
  return best;
}

function joinWords(words, language) {
  const lang = String(language || 'en').toLowerCase();
  const conj = lang === 'sw' || lang === 'sheng' ? 'na' : 'and';
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} ${conj} ${words[words.length - 1]}`;
}

function titleWord(word) {
  const w = String(word || '');
  if (!w) return '';
  if (/^(?:and|na|or|au)$/i.test(w)) return w.toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function spokenLabel(raw) {
  return String(raw || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

/**
 * @param {{ name: string, category?: string }[]} rows
 * @param {{ language?: string }} [opts]
 * @returns {{ label: string, members: string[], first: number }[]}
 *   Families of two or more rows first (largest first), then single rows in
 *   file order. Every row lands in exactly one entry.
 */
function serviceFamilies(rows, opts = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      index,
      name: displayName(row?.name),
      category: String(row?.category || '').trim(),
      words: contentWords(row?.name),
    }))
    .filter((row) => row.name);
  const activity = catalogueActivity(list);
  const categories = new Map();
  for (const row of list) {
    if (!row.category) continue;
    const key = row.category.toLowerCase();
    categories.set(key, (categories.get(key) || 0) + 1);
  }
  // A category on every row says nothing; one on a few rows is a family.
  const usefulCategory = (key) => (categories.get(key) || 0) >= 2 && categories.get(key) < list.length;

  const left = new Set(list.map((row) => row.index));
  const families = [];
  for (;;) {
    const counts = new Map();
    for (const row of list) {
      if (!left.has(row.index)) continue;
      const keys = new Set(row.words.map((w) => `w:${w}`));
      if (row.category && usefulCategory(row.category.toLowerCase())) {
        keys.add(`c:${row.category.toLowerCase()}`);
      }
      for (const key of keys) {
        const hit = counts.get(key) || { n: 0, first: row.index };
        hit.n += 1;
        counts.set(key, hit);
      }
    }
    let pick = null;
    for (const [key, hit] of counts) {
      if (hit.n < 2) continue;
      if (!pick || hit.n > pick.n || (hit.n === pick.n && hit.first < pick.first)) {
        pick = { key, ...hit };
      }
    }
    if (!pick) break;
    const members = list.filter((row) => {
      if (!left.has(row.index)) return false;
      if (pick.key.startsWith('c:')) return row.category.toLowerCase() === pick.key.slice(2);
      return row.words.includes(pick.key.slice(2));
    });
    for (const row of members) left.delete(row.index);
    families.push({ key: pick.key, members, first: pick.first });
  }

  const out = families.map(({ key, members, first }) => {
    let label;
    if (key.startsWith('c:')) {
      label = members[0].category.toLowerCase();
    } else {
      const shared = key.slice(2);
      const heads = [];
      for (const row of members) {
        const head = row.words[row.words.length - 1] || shared;
        if (!heads.includes(head)) heads.push(head);
      }
      const core = heads.length <= 2 ? joinWords(heads, opts.language) : shared;
      label = activity && !core.endsWith(activity) ? `${core} ${activity}` : core;
    }
    return { label: spokenLabel(label), members: members.map((row) => row.name), first };
  });
  out.sort((a, b) => b.members.length - a.members.length || a.first - b.first);
  for (const row of list) {
    if (left.has(row.index)) out.push({ label: row.name, members: [row.name], first: row.index });
  }
  return out;
}

module.exports = { serviceFamilies, displayName };
