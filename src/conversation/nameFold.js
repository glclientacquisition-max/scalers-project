'use strict';

/**
 * BRAIN_NAME_FOLD (Chief ruling, 18 Oct 2026, HD_af5868852bc7).
 *
 * Two one-word names on one phone that are speech-to-text spellings of the
 * same name (Alwyn/Alvin, Brian/Bryan, Collins/Colin) are ONE person, not a
 * shared line. A truly different name (Alwyn/Mary) stays a second person.
 *
 * This file is the contract. It has no imports so Desk
 * (dashboard/src/lib/contactIdentity.ts) can mirror it line for line.
 * The cases both sides must agree on are in
 * tests/fixtures/name-fold-cases.json.
 *
 * Rule:
 *   1. Both names are one word.
 *   2. Same first letter after the sound map (c->k, v/f->w ...).
 *   3. Same sound key -> fold. Otherwise, only when both names have 5+
 *      letters: same last key letter, same consonant skeleton, and key edit
 *      distance <= 2 -> fold.
 *   Anything else stays distinct.
 */

/** Off unless the value is exactly "on". */
function nameFoldEnabled(env = process.env) {
  return String((env && env.BRAIN_NAME_FOLD) || '').trim() === 'on';
}

function foldCompact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z]/g, '');
}

function foldDistance(a, b) {
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

/**
 * Kenyan-English sound key for one name. STT swaps these on one speaker:
 * ph/f/v/w, l/r, c/k/q, z/s, y/i; a silent h after the first letter
 * (Jhon, Esther, Sarah); double letters; a trailing e or s (Anne, Collins).
 */
function nameFoldKey(value) {
  let s = foldCompact(value);
  if (!s) return '';
  s = s
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/[cq]/g, 'k')
    .replace(/[fv]/g, 'w')
    .replace(/l/g, 'r')
    .replace(/z/g, 's')
    .replace(/y/g, 'i');
  s = s.charAt(0) + s.slice(1).replace(/h/g, '');
  s = s.replace(/(.)\1+/g, '$1');
  if (s.length > 2) s = s.replace(/[es]$/, '');
  return s;
}

function consonantSkeleton(key) {
  return String(key || '').replace(/[aeiou]/g, '');
}

/**
 * True when a and b are STT spellings of one name. Pure; ignores the flag.
 * Short names never fold on distance alone (Tom/Tim, Dan/Don, Mark/Mary).
 * A different last letter (Peter/Petra, Joy/Joe, Grace/Gracie) or a
 * different consonant (Martin/Marvin, Kevin/Kelvin) stays two people.
 */
function namesFold(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (/\s/.test(left) || /\s/.test(right)) return false;
  const ka = nameFoldKey(left);
  const kb = nameFoldKey(right);
  if (!ka || !kb || ka[0] !== kb[0]) return false;
  if (ka === kb) return true;
  const minLen = Math.min(foldCompact(left).length, foldCompact(right).length);
  if (minLen < 5) return false;
  if (ka[ka.length - 1] !== kb[kb.length - 1]) return false;
  if (consonantSkeleton(ka) !== consonantSkeleton(kb)) return false;
  return foldDistance(ka, kb) <= 2;
}

module.exports = {
  nameFoldEnabled,
  nameFoldKey,
  namesFold,
  consonantSkeleton,
};
