/**
 * Mine hard names from recent agent transcripts for pronunciation training.
 */

import {
  BLOCKED_MATCH_TOKENS,
  isBlockedMatch,
  matchPatternFromPhrase,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  isTargetCovered,
  type PronunciationSuggestion,
} from "@/lib/pronunciationSuggest";

const EXTRA_SKIP = new Set(
  [
    ...BLOCKED_MATCH_TOKENS,
    "take",
    "time",
    "great",
    "day",
    "evening",
    "morning",
    "assist",
    "help",
    "name",
    "please",
    "thank",
    "thanks",
    "shillings",
    "thousand",
    "monday",
    "saturday",
    "delivery",
    "shipping",
    "countrywide",
    "nairobi",
    "follow",
    "shortly",
  ].map((w) => w.toLowerCase())
);

function looksHardChunk(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 48) return false;
  const lower = t.toLowerCase();
  if (EXTRA_SKIP.has(lower)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/[^\x00-\x7F]/.test(t)) return true;
  if (/[a-z][A-Z]/.test(t)) return true;
  if (/^[A-Z][a-z]{2,}/.test(t) && !EXTRA_SKIP.has(lower)) return true;
  if (t.split(/\s+/).length >= 2) return true;
  return false;
}

/** Extract candidate hard phrases from agent transcript text. */
export function extractHardPhrasesFromText(text: string): string[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const out: string[] = [];

  const titleRuns =
    raw.match(/\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,3})\b/g) || [];
  for (const run of titleRuns) {
    if (looksHardChunk(run)) out.push(run.trim());
  }

  return out;
}

export function mineSuggestionsFromAgentLines(opts: {
  lines: string[];
  existingLexicon?: TtsLexiconEntry[] | null;
  limit?: number;
}): PronunciationSuggestion[] {
  const existing = opts.existingLexicon || [];
  const limit = opts.limit ?? 6;
  const counts = new Map<string, { label: string; count: number }>();

  for (const line of opts.lines) {
    for (const phrase of extractHardPhrasesFromText(line)) {
      const key = phrase.toLowerCase();
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { label: phrase, count: 1 });
    }
  }

  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || b.label.length - a.label.length
  );

  const suggestions: PronunciationSuggestion[] = [];
  for (const row of ranked) {
    const match = matchPatternFromPhrase(row.label);
    if (!match || isBlockedMatch(match)) continue;
    if (isTargetCovered({ label: row.label, match }, existing)) continue;

    const natural =
      /\b(street|road|avenue|mall|market|books?)\b/i.test(row.label)
        ? `We're near ${row.label}`
        : row.label.split(/\s+/).length >= 2
          ? `You can ask for ${row.label}`
          : `This is ${row.label}`;

    suggestions.push({
      id: `mine:${match.toLowerCase().slice(0, 40)}`,
      label: "From calls",
      prompt: /[.?!]$/.test(natural) ? natural : `${natural}.`,
      kind: "sentence",
      reason:
        row.count > 1
          ? `Heard ${row.count} times on recent calls — may need clearer TTS.`
          : "Spotted on a recent call — train if it sounded wrong.",
      targets: [{ label: row.label, match }],
      match,
      priority: 60 + Math.min(20, row.count * 3),
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

/** Build a renew / manual custom training line for one phrase. */
export function customTrainingLine(opts: {
  phrase: string;
  reason?: string;
  idPrefix?: string;
}): PronunciationSuggestion | null {
  const phrase = String(opts.phrase || "")
    .trim()
    .replace(/\s+/g, " ");
  if (phrase.length < 2 || phrase.length > 120) return null;
  const match = matchPatternFromPhrase(phrase);
  if (!match || isBlockedMatch(match)) return null;

  const words = phrase.split(/\s+/);
  const isSentence = words.length >= 4 || /[.?!]$/.test(phrase);

  if (isSentence) {
    const chunks = extractHardPhrasesFromText(phrase);
    const targets = (chunks.length ? chunks : [phrase])
      .map((label) => {
        const m = matchPatternFromPhrase(label);
        if (!m || isBlockedMatch(m)) return null;
        return { label, match: m };
      })
      .filter(Boolean) as Array<{ label: string; match: string }>;
    if (!targets.length) return null;
    return {
      id: `${opts.idPrefix || "custom"}:${targets[0].match.toLowerCase().slice(0, 40)}`,
      label: opts.idPrefix === "renew" ? "Renew" : "Custom",
      prompt: /[.?!]$/.test(phrase) ? phrase : `${phrase}.`,
      kind: "sentence",
      reason:
        opts.reason || "You added this because it sounded wrong on a call.",
      targets,
      match: targets[0].match,
      priority: 95,
    };
  }

  const prompt =
    words.length >= 2
      ? `You can ask for ${phrase}.`
      : `This is ${phrase}.`;

  return {
    id: `${opts.idPrefix || "custom"}:${match.toLowerCase().slice(0, 40)}`,
    label: opts.idPrefix === "renew" ? "Renew" : "Custom",
    prompt,
    kind: "sentence",
    reason:
      opts.reason || "You added this because it sounded wrong on a call.",
    targets: [{ label: phrase, match }],
    match,
    priority: 95,
  };
}
