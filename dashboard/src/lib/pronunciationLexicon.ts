/**
 * Per-tenant TTS lexicon helpers (Desk Train → voice prepareForTts).
 * Shape matches src/speech/pronunciationLexicon.js overrides.
 */

export type TtsLexiconEntry = {
  match: string;
  say: string;
  langs?: Array<"en" | "sw" | "sheng">;
  priority?: number;
  /** Display label shown in the coach (not sent to TTS). */
  label?: string;
  /** word | sentence — coach metadata only. */
  kind?: "word" | "sentence";
};

export const TTS_LEXICON_MAX = 24;
export const TTS_MATCH_MAX = 80;
export const TTS_SAY_MAX = 120;

/** Never train these as match keys — they wreck whole phone sentences. */
export const BLOCKED_MATCH_TOKENS = new Set(
  [
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "is",
    "are",
    "was",
    "be",
    "this",
    "that",
    "how",
    "what",
    "where",
    "when",
    "who",
    "why",
    "can",
    "you",
    "we",
    "i",
    "me",
    "my",
    "your",
    "our",
    "please",
    "thanks",
    "thank",
    "hello",
    "hi",
    "yes",
    "no",
    "ok",
    "okay",
    "shop",
    "store",
    "street",
    "road",
    "avenue",
    "city",
    "market",
    "mall",
    "fashion",
    "opposite",
    "located",
    "location",
    "book",
    "books",
    "bookstore",
    "paper",
    "white",
    "customers",
    "customer",
    "notify",
    "kenya",
    "nairobi",
    "sundays",
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "same-day",
    "sameday",
    "in-store",
    "instore",
    "delivery",
    "shipping",
    "welcome",
    "speaking",
    "help",
    "today",
    "call",
    "calling",
    "reached",
  ].map((t) => t.toLowerCase())
);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isBlockedMatch(match: string): boolean {
  const raw = String(match || "").trim();
  if (!raw) return true;
  const plain = raw
    .replace(/\\s\+|\\s\*|\\s/gi, " ")
    .replace(/[\\^$|()?+*[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!plain) return true;
  const parts = plain.split(" ").filter(Boolean);
  // Only block single common words (city, where, book…).
  // Multi-word place names like "City Market Fashion Mall" are allowed.
  if (parts.length === 1 && BLOCKED_MATCH_TOKENS.has(parts[0])) return true;
  // Two-word filler only (e.g. "the shop") — still block.
  if (parts.length === 2 && parts.every((p) => BLOCKED_MATCH_TOKENS.has(p))) {
    return true;
  }
  return false;
}

export function sanitizeSayForm(say: string): string {
  let s = String(say || "").trim();
  if (!s) return "";
  s = s.replace(/-+/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
  s = s
    .split(" ")
    .map((token) => {
      const hyphens = (token.match(/-/g) || []).length;
      const letters = token.replace(/[^a-zA-Z]/g, "");
      if (hyphens >= 2 && letters.length <= 8) {
        const joined = token.replace(/-/g, "");
        if (BLOCKED_MATCH_TOKENS.has(joined.toLowerCase())) {
          return joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
        }
      }
      // Cap extreme hyphenation on proper names (keep at most 2 hyphens per token)
      if (hyphens > 2) {
        const bits = token.split("-");
        return `${bits[0]}-${bits.slice(1).join("")}`;
      }
      return token;
    })
    .join(" ");
  return s.slice(0, TTS_SAY_MAX);
}

/** Build a case-insensitive word-boundary match pattern from a display phrase. */
export function matchPatternFromPhrase(phrase: string): string {
  const cleaned = String(phrase || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return "";

  const lower = cleaned.toLowerCase();
  const words = lower.split(" ").filter(Boolean);
  if (!words.length) return "";

  if (words.length === 1) {
    const word = words[0];
    const camelParts = word
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (camelParts.length > 1) {
      const spaced = camelParts.map(escapeRegex).join("\\s*");
      const glued = camelParts.map(escapeRegex).join("");
      return `${spaced}|${glued}`.slice(0, TTS_MATCH_MAX);
    }
    return escapeRegex(word).slice(0, TTS_MATCH_MAX);
  }

  const spaced = words.map(escapeRegex).join("\\s+");
  const loose = words.map(escapeRegex).join("\\s*");
  const glued = words.map(escapeRegex).join("");
  return `${spaced}|${loose}|${glued}`.slice(0, TTS_MATCH_MAX);
}

export function parseTtsLexicon(raw: unknown): TtsLexiconEntry[] {
  if (raw == null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  const out: TtsLexiconEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const match = String(row.match || row.from || "").trim();
    const say = sanitizeSayForm(String(row.say || row.to || ""));
    if (!match || !say) continue;
    if (match.length > TTS_MATCH_MAX || say.length > TTS_SAY_MAX) continue;
    if (isBlockedMatch(match)) continue;
    try {
      const source = match.startsWith("\\b") ? match : `\\b(?:${match})\\b`;
      new RegExp(source, "gi");
    } catch {
      continue;
    }
    const entry: TtsLexiconEntry = {
      match,
      say,
      langs: Array.isArray(row.langs)
        ? (row.langs as TtsLexiconEntry["langs"])
        : ["en", "sw", "sheng"],
      priority: Number(row.priority) >= 0 ? Number(row.priority) : 200,
    };
    if (typeof row.label === "string" && row.label.trim()) {
      entry.label = row.label.trim().slice(0, 120);
    }
    if (row.kind === "word" || row.kind === "sentence") {
      entry.kind = row.kind;
    }
    out.push(entry);
  }
  return out.slice(0, TTS_LEXICON_MAX);
}

/** Upsert by normalized match; newest wins. */
export function mergeLexiconEntry(
  existing: TtsLexiconEntry[],
  next: TtsLexiconEntry
): TtsLexiconEntry[] {
  const cleaned = parseTtsLexicon([next]);
  if (!cleaned.length) return parseTtsLexicon(existing);
  const entry = cleaned[0];
  const matchKey = entry.match.trim().toLowerCase();
  const filtered = parseTtsLexicon(existing).filter(
    (e) => e.match.trim().toLowerCase() !== matchKey
  );
  return parseTtsLexicon([...filtered, entry]);
}

/** Merge many entries (sentence coach may train several targets at once). */
export function mergeLexiconEntries(
  existing: TtsLexiconEntry[],
  next: TtsLexiconEntry[]
): TtsLexiconEntry[] {
  let out = parseTtsLexicon(existing);
  for (const entry of next) {
    out = mergeLexiconEntry(out, entry);
  }
  return out;
}

/**
 * Human-readable label from a match regex (when label was never stored).
 * "muindi\\s+mbingu|…" → "Muindi Mbingu"
 */
export function humanLabelFromMatch(match: string): string {
  const firstAlt = String(match || "").split("|")[0] || "";
  const plain = firstAlt
    .replace(/\\s\+/gi, " ")
    .replace(/\\s\*/gi, " ")
    .replace(/\\s/gi, " ")
    .replace(/\\-/g, "-")
    .replace(/\\(.)/g, "$1")
    .replace(/[()^$?+*[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  return plain
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 120);
}

/** Prefer stored label; never fall back to phonetic `say` (that breaks Renew). */
export function displayLexiconLabel(entry: TtsLexiconEntry): string {
  const labeled = String(entry.label || "").trim();
  if (labeled) return labeled;
  return humanLabelFromMatch(entry.match) || entry.match;
}

/**
 * Persist match/say for voice, plus label so Desk Renew/list stay readable.
 * Voice parse ignores unknown fields safely.
 */
export function lexiconForStorage(entries: TtsLexiconEntry[]): Array<{
  match: string;
  say: string;
  langs?: TtsLexiconEntry["langs"];
  priority?: number;
  label?: string;
}> {
  return parseTtsLexicon(entries).map((e) => {
    const label = displayLexiconLabel(e);
    const row: {
      match: string;
      say: string;
      langs?: TtsLexiconEntry["langs"];
      priority?: number;
      label?: string;
    } = {
      match: e.match,
      say: e.say,
      langs: e.langs || ["en", "sw", "sheng"],
      priority: e.priority ?? 200,
    };
    if (label) row.label = label;
    return row;
  });
}

/** Plain fallback when Gemini is unavailable: space camelCase, keep readable. */
export function localSayFallback(phrase: string): string {
  const text = String(phrase || "").trim();
  if (!text) return "";
  return sanitizeSayForm(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}
