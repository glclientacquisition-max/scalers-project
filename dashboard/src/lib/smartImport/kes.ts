/**
 * Kenyan price text -> one canonical price string the catalogue validator accepts
 * ("1500", "from 300", "500-800", "ask"). Pure and browser-safe.
 */
export type KesPrice = {
  text: string;
  mode: "fixed" | "from" | "range" | "ask" | "";
  min: number | null;
  max: number | null;
};

const MAX = 10_000_000;

/** "1,500", "1.5k", "2k", "1500/=", "1500/-" -> 1500. Null when not a sane amount. */
export function kesAmount(raw: string): number | null {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/\b(kes|kshs?|sh|bob)(?![a-z])\.?/g, "")
    .replace(/\/[=-]/g, "")
    .replace(/[,\s]/g, "")
    .trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  if (!Number.isFinite(n) || n < 0 || n > MAX) return null;
  return Math.round(n);
}

const AMOUNT = String.raw`(?:kes|kshs?|sh)?\.?\s*\d[\d,]*(?:\.\d+)?\s*[km]?\s*(?:\/[=-])?\s*(?:kes|kshs?|bob)?`;

export function parseKesPrice(raw: unknown): KesPrice {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const empty: KesPrice = { text: "", mode: "", min: null, max: null };
  if (!text) return empty;
  const lower = text.toLowerCase();
  if (/\b(ask|on request|quote|quoted|call for price|bei ya maongezi)\b/.test(lower) && !/\d/.test(lower)) {
    return { text: "ask", mode: "ask", min: null, max: null };
  }
  const range = lower.match(new RegExp(`(${AMOUNT})\\s*(?:-|–|—|to|hadi|mpaka)\\s*(${AMOUNT})`));
  if (range) {
    const a = kesAmount(range[1]);
    const b = kesAmount(range[2]);
    if (a != null && b != null) {
      const [min, max] = a <= b ? [a, b] : [b, a];
      if (min === max) return { text: String(min), mode: "fixed", min, max };
      return { text: `${min}-${max}`, mode: "range", min, max };
    }
  }
  const from = lower.match(new RegExp(`\\b(?:from|starting(?: at| from)?|kuanzia|min(?:imum)?)\\s*(${AMOUNT})`));
  if (from) {
    const a = kesAmount(from[1]);
    if (a != null) return { text: `from ${a}`, mode: "from", min: a, max: null };
  }
  const one = lower.match(new RegExp(AMOUNT));
  if (one) {
    const a = kesAmount(one[0]);
    if (a != null) return { text: String(a), mode: "fixed", min: a, max: a };
  }
  return empty;
}
