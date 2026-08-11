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

export const TTS_LEXICON_MAX = 40;
export const TTS_MATCH_MAX = 80;
export const TTS_SAY_MAX = 120;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    // Camel / glued brands: ChapterOne → chapter\s*one|chapterone
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
    const say = String(row.say || row.to || "").trim();
    if (!match || !say) continue;
    if (match.length > TTS_MATCH_MAX || say.length > TTS_SAY_MAX) continue;
    try {
      const source = match.startsWith("\\b") ? match : `\\b(?:${match})\\b`;
      new RegExp(source, "gi");
    } catch {
      continue;
    }
    const entry: TtsLexiconEntry = {
      match,
      say: say.slice(0, TTS_SAY_MAX),
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
  const matchKey = next.match.trim().toLowerCase();
  const filtered = existing.filter(
    (e) => e.match.trim().toLowerCase() !== matchKey
  );
  return parseTtsLexicon([...filtered, next]);
}

/** Merge many entries (sentence coach may train several targets at once). */
export function mergeLexiconEntries(
  existing: TtsLexiconEntry[],
  next: TtsLexiconEntry[]
): TtsLexiconEntry[] {
  let out = existing;
  for (const entry of next) {
    out = mergeLexiconEntry(out, entry);
  }
  return out;
}

/** Drop coach-only fields before persisting to tenants.tts_lexicon. */
export function lexiconForStorage(entries: TtsLexiconEntry[]): Array<{
  match: string;
  say: string;
  langs?: TtsLexiconEntry["langs"];
  priority?: number;
}> {
  return parseTtsLexicon(entries).map((e) => ({
    match: e.match,
    say: e.say,
    langs: e.langs || ["en", "sw", "sheng"],
    priority: e.priority ?? 200,
  }));
}

/** Plain fallback when Gemini is unavailable: space camelCase, keep readable. */
export function localSayFallback(phrase: string): string {
  const text = String(phrase || "").trim();
  if (!text) return "";
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TTS_SAY_MAX);
}
