/**
 * Mine hard names from recent agent transcripts for pronunciation training.
 * Prefers profile names/places and multi-word proper nouns; skips weak English filler.
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

/** Words that look Title Case in transcripts but should never become training targets. */
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
    "hello",
    "you've",
    "reached",
    "speaking",
    "just",
    "money",
    "habari",
    "jambo",
    "sasa",
    "okay",
    "alright",
    "right",
    "sure",
    "fine",
    "well",
    "also",
    "then",
    "here",
    "there",
    "about",
    "after",
    "before",
    "again",
    "still",
    "really",
    "actually",
    "maybe",
    "sorry",
    "excuse",
    "moment",
    "seconds",
    "minutes",
    "hours",
    "number",
    "phone",
    "email",
    "whatsapp",
    "order",
    "orders",
    "price",
    "prices",
    "available",
    "open",
    "closed",
    "hours",
    "service",
    "services",
    "question",
    "questions",
    "anything",
    "else",
    "need",
    "want",
    "like",
    "know",
    "think",
    "look",
    "looking",
    "coming",
    "going",
    "would",
    "could",
    "should",
    "will",
    "shall",
    "have",
    "has",
    "had",
    "been",
    "being",
    "does",
    "did",
    "done",
    "make",
    "made",
    "get",
    "got",
    "give",
    "put",
    "see",
    "hear",
    "heard",
    "said",
    "say",
    "tell",
    "ask",
    "asked",
    "call",
    "called",
    "calling",
    "back",
    "soon",
    "later",
    "today",
    "tomorrow",
    "yesterday",
    "week",
    "month",
    "year",
    "first",
    "last",
    "next",
    "other",
    "another",
    "some",
    "any",
    "all",
    "every",
    "each",
    "both",
    "few",
    "many",
    "much",
    "more",
    "most",
    "same",
    "such",
    "only",
    "own",
    "other",
    "into",
    "over",
    "under",
    "again",
    "further",
    "once",
    "twice",
    "very",
    "too",
    "so",
    "than",
    "too",
    "very",
    "just",
    "even",
    "still",
    "already",
    "yet",
    "now",
    "then",
    "here",
    "there",
    "where",
    "when",
    "why",
    "how",
    "what",
    "who",
    "which",
    "whose",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "english",
    "swahili",
    "kenya",
    "kenyan",
    "africa",
    "african",
    "customer",
    "customers",
    "client",
    "clients",
    "sir",
    "madam",
    "miss",
    "mister",
    "brother",
    "sister",
    "friend",
    "friends",
  ].map((w) => w.toLowerCase())
);

/**
 * Common English (and light Sheng fillers) that Title Case ASR invents.
 * Never treat these as proper-name signals for mining.
 */
const WEAK_SINGLE_ENGLISH = new Set(
  [
    "just",
    "money",
    "good",
    "great",
    "time",
    "take",
    "name",
    "help",
    "please",
    "thanks",
    "thank",
    "hello",
    "welcome",
    "speaking",
    "reached",
    "follow",
    "shortly",
    "delivery",
    "shipping",
    "order",
    "price",
    "open",
    "closed",
    "available",
    "service",
    "question",
    "moment",
    "number",
    "phone",
    "email",
    "today",
    "tomorrow",
    "morning",
    "evening",
    "afternoon",
    "night",
    "weekend",
    "weekday",
    "cashier",
    "manager",
    "assistant",
    "reception",
    "receptionist",
    "bookstore",
    "library",
    "market",
    "mall",
    "street",
    "road",
    "avenue",
    "building",
    "floor",
    "shop",
    "store",
    "office",
    "centre",
    "center",
    "place",
    "area",
    "side",
    "way",
    "near",
    "opposite",
    "beside",
    "across",
    "inside",
    "outside",
    "chapter",
    "one",
    "two",
    "three",
    "four",
    "five",
    "check",
    "checking",
    "hold",
    "holding",
    "while",
    "wait",
    "waiting",
    "confirm",
    "confirming",
    "transfer",
    "connect",
    "connecting",
    "forward",
    "details",
    "information",
    "option",
    "options",
    "payment",
    "payments",
    "receipt",
    "invoice",
    "stock",
    "item",
    "items",
    "product",
    "products",
    "brand",
    "brands",
    "copy",
    "copies",
    "edition",
    "author",
    "title",
    "titles",
    "novel",
    "novels",
    "school",
    "schools",
    "college",
    "university",
    "station",
    "terminal",
    "bus",
    "matatu",
    "taxi",
    "uber",
    "bolt",
    "parking",
    "entrance",
    "exit",
    "gate",
    "main",
    "new",
    "old",
    "best",
    "better",
    "free",
    "full",
    "half",
    "ready",
    "busy",
    "able",
    "happy",
    "glad",
    "sure",
    "fine",
    "okay",
    "alright",
    "right",
    "correct",
    "wrong",
    "problem",
    "issue",
    "issues",
    "sorry",
    "excuse",
    "pardon",
    "repeat",
    "again",
    "slowly",
    "clearly",
    "louder",
    "line",
    "lines",
    "queue",
    "appointment",
    "booking",
    "reservation",
    "visit",
    "visiting",
    "coming",
    "going",
    "leaving",
    "arrive",
    "arrival",
    "collect",
    "collection",
    "pickup",
    "drop",
    "dropoff",
    "habari",
    "jambo",
    "sasa",
    "asante",
    "karibu",
    "sawa",
    "poa",
    "ndio",
    "hapana",
    "bwana",
    "dada",
    "kiongozi",
  ].map((w) => w.toLowerCase())
);

function isWeakToken(word: string): boolean {
  const lower = word.trim().toLowerCase().replace(/[^a-z'’-]/g, "");
  if (!lower) return true;
  return (
    EXTRA_SKIP.has(lower) ||
    WEAK_SINGLE_ENGLISH.has(lower) ||
    BLOCKED_MATCH_TOKENS.has(lower)
  );
}

/**
 * Strong proper-name / hard-place signal — not merely "Title Case English".
 * camelCase brands, non-ASCII, or uncommon tokens (Kenyan names, etc.).
 */
function wordLooksHard(word: string): boolean {
  const w = word.trim();
  if (w.length < 3) return false;
  if (isWeakToken(w)) return false;
  if (/[^\x00-\x7F]/.test(w)) return true;
  if (/[a-z][A-Z]/.test(w)) return true; // ChapterOne
  // Uncommon Title Case token ≥4 letters — likely a person/place name
  if (/^[A-Z][a-zA-Z'’]{3,}$/.test(w)) return true;
  return false;
}

function looksHardChunk(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 48) return false;
  const lower = t.toLowerCase();
  if (EXTRA_SKIP.has(lower) || WEAK_SINGLE_ENGLISH.has(lower)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/[^\x00-\x7F]/.test(t)) return true;
  if (/[a-z][A-Z]/.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    // Alone: only mine if it looks like a proper / hard name — not "Just"/"Money"
    return wordLooksHard(words[0]);
  }

  // Multi-word: require at least one strong proper-name signal
  if (words.every((w) => isWeakToken(w))) return false;
  return words.some((w) => wordLooksHard(w));
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

/**
 * Collect profile names/places to spot in transcripts even when ASR is lowercase.
 */
export function collectKnownPronunciationHints(input: {
  businessName?: string | null;
  agentName?: string | null;
  team?: Array<{ name?: string } | string> | null;
  locations?: Array<{
    label?: string;
    address?: string;
    landmark?: string;
  }> | null;
}): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = String(v || "")
      .trim()
      .replace(/\s+/g, " ");
    if (t.length < 2 || t.length > 60) return;
    if (isBlockedMatch(matchPatternFromPhrase(t))) return;
    out.push(t);
  };

  push(input.businessName || "");
  const agent = String(input.agentName || "").trim();
  if (agent && !/^receptionist$/i.test(agent)) push(agent);

  for (const member of input.team || []) {
    push(typeof member === "string" ? member : member?.name || "");
  }

  for (const loc of input.locations || []) {
    const address = String(loc.address || "").trim();
    if (address) {
      const first = address.split(",")[0].trim();
      push(first);
      const streetRun =
        first.match(/\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,3})\b/) ||
        null;
      if (streetRun) push(streetRun[1]);
      // Also push individual hard tokens from the street line (Muindi, Mbingu)
      for (const part of first.split(/\s+/)) {
        const cleaned = part.replace(/[^a-zA-Z'’-]/g, "");
        if (cleaned.length >= 4 && wordLooksHard(cleaned)) push(cleaned);
      }
    }
    const landmark = String(loc.landmark || "")
      .trim()
      .replace(/^(opposite|near|next to|beside)\s+/i, "")
      .split(",")[0]
      .trim();
    push(landmark);
    push(loc.label || "");
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const h of out) {
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
  }
  return unique.slice(0, 40);
}

function countHintInLines(hint: string, lines: string[]): number {
  const needle = hint.toLowerCase().replace(/\s+/g, " ").trim();
  if (needle.length < 2) return 0;
  let count = 0;
  for (const line of lines) {
    const hay = line.toLowerCase().replace(/\s+/g, " ");
    if (hay.includes(needle)) count += 1;
  }
  return count;
}

type MineRow = {
  label: string;
  count: number;
  boosted: boolean;
  score: number;
};

function scoreRow(row: Omit<MineRow, "score">): number {
  const words = row.label.split(/\s+/).filter(Boolean);
  let score = row.count * 10;
  if (row.boosted) score += 100;
  if (words.length >= 2) score += 25;
  if (/[a-z][A-Z]/.test(row.label)) score += 35;
  if (/[^\x00-\x7F]/.test(row.label)) score += 20;
  if (words.length === 1 && WEAK_SINGLE_ENGLISH.has(row.label.toLowerCase())) {
    score -= 80;
  }
  // Prefer longer proper phrases slightly
  score += Math.min(15, row.label.length);
  return score;
}

/** Drop shorter phrases that are fully contained in a stronger longer phrase. */
function collapseOverlaps(rows: MineRow[]): MineRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.score - a.score ||
      b.label.length - a.label.length ||
      Number(b.boosted) - Number(a.boosted)
  );
  const kept: MineRow[] = [];
  for (const row of sorted) {
    const key = row.label.toLowerCase();
    const covered = kept.some((k) => {
      const kk = k.label.toLowerCase();
      if (kk === key) return true;
      // Prefer longer: "muindi mbingu" covers "muindi"
      if (kk.includes(key) && k.score >= row.score - 15) return true;
      // Prefer boosted shorter profile name over noisy longer Title Case run
      if (key.includes(kk) && row.boosted && !k.boosted && row.score > k.score) {
        return false;
      }
      return false;
    });
    if (covered) continue;
    // If this longer phrase contains a kept shorter boosted name, replace when stronger
    const weakerIdx = kept.findIndex((k) => {
      const kk = k.label.toLowerCase();
      return key.includes(kk) && key !== kk && row.score > k.score + 10;
    });
    if (weakerIdx >= 0 && !kept[weakerIdx].boosted) {
      kept.splice(weakerIdx, 1, row);
      continue;
    }
    kept.push(row);
  }
  return kept;
}

export function mineSuggestionsFromAgentLines(opts: {
  lines: string[];
  existingLexicon?: TtsLexiconEntry[] | null;
  knownHints?: string[] | null;
  limit?: number;
}): PronunciationSuggestion[] {
  const existing = opts.existingLexicon || [];
  const limit = opts.limit ?? 6;
  const counts = new Map<string, { label: string; count: number; boosted: boolean }>();

  for (const line of opts.lines) {
    for (const phrase of extractHardPhrasesFromText(line)) {
      const key = phrase.toLowerCase();
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { label: phrase, count: 1, boosted: false });
    }
  }

  // Profile hints: catch lowercase ASR ("muindi mbingu street") and boost known names.
  for (const hint of opts.knownHints || []) {
    const hits = countHintInLines(hint, opts.lines);
    if (hits <= 0) continue;
    const key = hint.toLowerCase();
    const prev = counts.get(key);
    if (prev) {
      prev.count += hits;
      prev.boosted = true;
      // Prefer the canonical profile spelling
      prev.label = hint;
    } else {
      counts.set(key, { label: hint, count: hits, boosted: true });
    }
  }

  const scored: MineRow[] = [...counts.values()]
    .map((row) => ({ ...row, score: scoreRow(row) }))
    .filter((row) => {
      const words = row.label.split(/\s+/);
      const lower = row.label.toLowerCase();
      if (EXTRA_SKIP.has(lower) || WEAK_SINGLE_ENGLISH.has(lower)) return false;
      // Unboosted single English-ish tokens need a real signal
      if (!row.boosted && words.length === 1) {
        if (!wordLooksHard(row.label)) return false;
        // Require repetition unless camelCase / non-ASCII
        if (
          row.count < 2 &&
          !/[a-z][A-Z]/.test(row.label) &&
          !/[^\x00-\x7F]/.test(row.label)
        ) {
          return false;
        }
      }
      // Unboosted multi-word common phrases need ≥2 hits or a hard token
      if (!row.boosted && words.length >= 2) {
        if (!words.some((w) => wordLooksHard(w)) && row.count < 2) return false;
      }
      return row.score >= 20;
    });

  const ranked = collapseOverlaps(scored).sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.boosted) - Number(a.boosted) ||
      b.count - a.count ||
      b.label.length - a.label.length
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
      reason: row.boosted
        ? row.count > 1
          ? `Your profile name appeared ${row.count} times on recent calls — train if it sounded wrong.`
          : "Heard on a recent call (matches your business profile) — train if unclear."
        : row.count > 1
          ? `Heard ${row.count} times on recent calls — may need clearer TTS.`
          : "Spotted on a recent call — train if it sounded wrong.",
      targets: [{ label: row.label, match }],
      match,
      priority: Math.min(
        95,
        (row.boosted ? 72 : 58) + Math.min(22, Math.round(row.score / 8))
      ),
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
