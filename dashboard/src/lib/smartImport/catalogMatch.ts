/**
 * Fuzzy name keys for import matching: "Chapati (1pc)" and "chapatis" are one item.
 * Pure and browser-safe.
 */
const SIZE_WORDS = /\b(\d+\s*(?:pcs?|pieces?|kg|g|gms?|ml|l|ltrs?|litres?|liters?|pack|pkt))\b/g;
const FILLER = new Set(["the", "a", "an", "of", "and", "na", "ya", "wa", "pc", "pcs", "piece", "pieces", "each", "per"]);

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && /(sh|ch|x|s)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function fuzzyKey(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(SIZE_WORDS, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w))
    .map(singular)
    .join(" ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0..1 similarity of two names after fuzzyKey. */
export function nameSimilarity(a: unknown, b: unknown): number {
  const ka = fuzzyKey(a);
  const kb = fuzzyKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ta = new Set(ka.split(" "));
  const tb = new Set(kb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / new Set([...ta, ...tb]).size;
  const edit = 1 - levenshtein(ka, kb) / Math.max(ka.length, kb.length);
  return Math.max(jaccard, edit);
}

export const MATCH_THRESHOLD = 0.86;

/** Best saved row for an incoming name (aliases count), or -1. */
export function bestMatch<T>(
  name: string,
  aliases: readonly string[],
  saved: readonly T[],
  nameOf: (row: T) => string[]
): { index: number; score: number } {
  let best = { index: -1, score: 0 };
  saved.forEach((row, index) => {
    for (const candidate of nameOf(row)) {
      for (const incoming of [name, ...aliases]) {
        const score = nameSimilarity(incoming, candidate);
        if (score > best.score) best = { index, score };
      }
    }
  });
  return best.score >= MATCH_THRESHOLD ? best : { index: -1, score: best.score };
}
