/**
 * Spoken rewrite of tenants.unknown_answer_fallback.
 * Voice reads en/sw only when source equals the trimmed fallback.
 * This module does not call Gemini. Server saves pass a generator.
 */

export const UNKNOWN_ANSWER_DEFAULT_EN = "Let me check with the team and get back to you.";
export const UNKNOWN_ANSWER_DEFAULT_SW = "Wacha niulize timu kisha nikujulishe.";

export const UNKNOWN_ANSWER_SPOKEN_COLUMN = "unknown_answer_spoken";

const SPOKEN_MAX = 220;

export type UnknownAnswerSpoken = {
  en: string;
  sw: string;
  source: string;
  updated_at: string;
};

export type SpokenLinePair = { en: string; sw: string };

export type SpokenGenerator = (source: string) => Promise<SpokenLinePair | null>;

const DROP_SENTENCE =
  /\b(?:transfer(?:ring)? you|transfer the call|put you through|connect you|connecting you|i(?:'ll| will) connect|live transfer)\b|\b(?:booking|appointment|reservation)\b[^.]{0,48}\bconfirm|\bconfirm(?:ed|ing)?\b[^.]{0,48}\b(?:booking|appointment|reservation)|\b(?:i(?:'ve| have)|we(?:'ve| have))\s+booked\b|\byou(?:'re| are) booked\b|\breserved for you\b|nikuunganishe|kuunganisha|nitaunganisha|nikuhamishe|kuhamisha|nitahamisha|imethibitishwa/i;

const TIME_PHRASE =
  "\\b(?:today|tomorrow|tonight|this morning|this afternoon|this evening|right now|within the hour|within an hour|within the next hour|leo|kesho|sasa hivi|ndani ya saa(?: moja)?|usiku huu|asubuhi hii|mchana huu|jioni hii)\\b|\\bin\\s+(?:\\d+|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|a few|a couple)\\s+(?:minutes?|mins?|hours?)\\b|\\b(?:dakika\\s*\\d+|\\d+\\s*dakika)\\b|\\bat\\s+\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?\\b|\\b\\d{1,2}:\\d{2}\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?\\b";

function expandBusinessAssistant(text: string): string {
  return text
    .replace(/\bB\.?\s*A\.?\b/g, "Business Assistant")
    .replace(/\b(?<!business\s)assistant\b/gi, "Business Assistant");
}

function sentencesOf(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

function tidy(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/^[,\s]+/, "")
    .replace(/\b(?:and|then|so|na|kisha|within|in|at|by|before|around|about)\s*$/i, "")
    .replace(/[,\s]+$/, "")
    .replace(/\.{2,}/g, ".")
    .trim();
}

/** Strip transfers, confirmed bookings, and specific times. Empty becomes the language default. */
export function sanitizeSpokenLine(raw: string, lang: "en" | "sw"): string {
  const fallback = lang === "sw" ? UNKNOWN_ANSWER_DEFAULT_SW : UNKNOWN_ANSWER_DEFAULT_EN;
  const expanded = expandBusinessAssistant(String(raw || ""));
  const kept: string[] = [];
  for (const sentence of sentencesOf(expanded)) {
    if (DROP_SENTENCE.test(sentence)) continue;
    const stripped = tidy(sentence.replace(new RegExp(TIME_PHRASE, "gi"), " "));
    if (!/[A-Za-z\u00C0-\u024F]/.test(stripped)) continue;
    kept.push(stripped);
  }
  let line = tidy(kept.join(" "));
  if (!line || line.length < 8) return fallback;
  if (line.length > SPOKEN_MAX) {
    line = line.slice(0, SPOKEN_MAX).replace(/\s+\S*$/, "").trim();
  }
  if (!/[.!?]$/.test(line)) line += ".";
  return line;
}

/** Deterministic lines when Gemini is missing, slow, or returns nothing usable. */
export function localSpokenLines(source: string): SpokenLinePair {
  return {
    en: sanitizeSpokenLine(source, "en"),
    sw: UNKNOWN_ANSWER_DEFAULT_SW,
  };
}

export function parseUnknownAnswerSpoken(value: unknown): UnknownAnswerSpoken | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = typeof row.source === "string" ? row.source : "";
  const en = typeof row.en === "string" ? row.en.trim() : "";
  const sw = typeof row.sw === "string" ? row.sw.trim() : "";
  if (!source || !en || !sw) return null;
  const updated_at = typeof row.updated_at === "string" ? row.updated_at : "";
  return { en, sw, source, updated_at };
}

function stamp(now?: string): string {
  return now || new Date().toISOString();
}

async function linesFor(source: string, generate: SpokenGenerator | null | undefined): Promise<SpokenLinePair> {
  if (generate) {
    try {
      const raw = await generate(source);
      if (raw && (raw.en.trim() || raw.sw.trim())) {
        return {
          en: sanitizeSpokenLine(raw.en, "en"),
          sw: sanitizeSpokenLine(raw.sw, "sw"),
        };
      }
    } catch {
      // The local lines below are the save-time fallback.
    }
  }
  return localSpokenLines(source);
}

/**
 * Empty fallback stores null.
 * An owner edit of the spoken lines keeps source when it still matches.
 * A changed fallback regenerates and ignores those edits.
 */
export async function resolveUnknownAnswerSpoken(input: {
  fallback: string;
  stored?: unknown;
  editedEn?: string;
  editedSw?: string;
  touched?: boolean;
  now?: string;
  generate?: SpokenGenerator | null;
}): Promise<UnknownAnswerSpoken | null> {
  const source = String(input.fallback || "").trim();
  if (!source) return null;

  const stored = parseUnknownAnswerSpoken(input.stored);
  const sameSource = stored?.source === source;

  if (sameSource && input.touched) {
    const enRaw = String(input.editedEn ?? stored.en).trim();
    const swRaw = String(input.editedSw ?? stored.sw).trim();
    return {
      en: sanitizeSpokenLine(enRaw, "en"),
      sw: sanitizeSpokenLine(swRaw, "sw"),
      source,
      updated_at: stamp(input.now),
    };
  }

  if (sameSource && stored) return stored;

  const lines = await linesFor(source, input.generate);
  return {
    en: lines.en,
    sw: lines.sw,
    source,
    updated_at: stamp(input.now),
  };
}
