/**
 * Are two caller names the same person heard two ways (speech-to-text near-spellings)?
 * Chief ruling 18 Oct 15:08 EAT: near-spellings on the same number are one person.
 *
 * INTERIM. Single export so Brain's fold (brain/name-fold, BRAIN_NAME_FOLD) can replace
 * the body without touching callers. Until then:
 * - fold case and accents, keep letters only, per word; word counts must match;
 * - spell sounds one way: ph→f, th→t, gh→g, ck/q→k, c→s before e/i/y else k,
 *   x→ks, y→i, silent h (after or before a consonant, or at the end), doubled letters once;
 * - names under 5 letters must fold to the same spelling;
 * - names of 5+ letters may differ by a weighted edit distance of at most 2:
 *   similar consonant (v/w/f, b/p, k/g, s/z, r/l, d/t, m/n) 0.5, h added or dropped 0.5,
 *   vowel added or dropped 0.75, vowel changed 1.25, other consonant added or dropped 1.5, different
 *   consonant 3. So Alwyn/Alvin fold, while Wanjiru/Wanjiku and Amina/Amani stay apart;
 * - first letters must match or be similar, and lengths may differ by 2 at most.
 */

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const SIMILAR: ReadonlyArray<string> = ["vwf", "bp", "kg", "sz", "rl", "dt", "mn"];

function similar(a: string, b: string): boolean {
  return SIMILAR.some((group) => group.includes(a) && group.includes(b));
}

function foldWord(word: string): string {
  let w = word;
  w = w.replace(/ph/g, "f").replace(/th/g, "t").replace(/gh/g, "g").replace(/ck/g, "k");
  w = w.replace(/q/g, "k").replace(/x/g, "ks");
  w = w.replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
  w = w.replace(/y/g, "i");
  // Silent h: after a consonant, before a consonant, or at the end.
  w = w.replace(/([^aeiouh])h/g, "$1").replace(/h(?=[^aeiou])/g, "").replace(/h$/, "");
  w = w.replace(/(.)\1+/g, "$1");
  return w;
}

function words(raw: unknown): string[] {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function indelCost(ch: string): number {
  if (ch === "h") return 0.5;
  return VOWELS.has(ch) ? 0.75 : 1.5;
}

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  if (VOWELS.has(a) && VOWELS.has(b)) return 1.25;
  if (similar(a, b)) return 0.5;
  return 3;
}

function weightedDistance(a: string, b: string): number {
  let prev = [0];
  for (let j = 1; j <= b.length; j += 1) prev[j] = prev[j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [prev[0] + indelCost(a[i - 1])];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + indelCost(a[i - 1]),
        cur[j - 1] + indelCost(b[j - 1]),
        prev[j - 1] + subCost(a[i - 1], b[j - 1])
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function wordsLikelySame(rawA: string, rawB: string): boolean {
  const a = foldWord(rawA);
  const b = foldWord(rawB);
  if (a === b) return true;
  if (rawA.length < 5 || rawB.length < 5) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a[0] !== b[0] && !similar(a[0], b[0])) return false;
  return weightedDistance(a, b) <= 2;
}

export function namesLikelySame(a: unknown, b: unknown): boolean {
  const left = words(a);
  const right = words(b);
  if (!left.length || left.length !== right.length) return false;
  return left.every((word, i) => wordsLikelySame(word, right[i]));
}
