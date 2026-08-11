/**
 * Auto-suggest hard words and short sentences for pronunciation training.
 * Deterministic — no LLM required. Gemini only refines the spoken form after record.
 */

import {
  matchPatternFromPhrase,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";

export type PronunciationSuggestion = {
  id: string;
  label: string;
  /** Phrase the owner should say out loud. */
  prompt: string;
  kind: "word" | "sentence";
  reason: string;
  /** Suggested match pattern for the lexicon. */
  match: string;
  priority: number;
};

export type PronunciationSuggestInput = {
  businessName?: string | null;
  agentName?: string | null;
  locationNotes?: string | null;
  locations?: Array<{
    label?: string;
    address?: string;
    landmark?: string;
    directions?: string;
  }> | null;
  team?: Array<{ name?: string; role?: string }> | null;
  services?: Array<{ name?: string }> | null;
  faqs?: Array<{ question?: string; answer?: string }> | null;
  bulletinTexts?: string[] | null;
  /** Existing lexicon — skip already trained matches. */
  existingLexicon?: TtsLexiconEntry[] | null;
};

const SUGGEST_MAX = 12;
const SENTENCE_MAX = 4;

/** Very common English words we never ask owners to record. */
const SKIP_WORDS = new Set(
  [
    "the",
    "and",
    "for",
    "with",
    "from",
    "your",
    "our",
    "you",
    "are",
    "is",
    "in",
    "on",
    "at",
    "to",
    "of",
    "a",
    "an",
    "we",
    "us",
    "or",
    "by",
    "be",
    "as",
    "this",
    "that",
    "have",
    "has",
    "will",
    "can",
    "please",
    "thank",
    "thanks",
    "hello",
    "hi",
    "yes",
    "no",
    "open",
    "close",
    "closed",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "am",
    "pm",
    "kes",
    "ksh",
    "shop",
    "store",
    "office",
    "home",
    "services",
    "service",
    "main",
    "branch",
    "street",
    "road",
    "avenue",
    "kenya",
    "nairobi",
    "receptionist",
    "manager",
    "owner",
    "customer",
    "call",
    "phone",
    "whatsapp",
    "email",
  ].map((w) => w.toLowerCase())
);

function slugId(kind: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${kind}:${slug || "item"}`;
}

function looksHard(token: string): boolean {
  const t = token.trim();
  if (t.length < 3 || t.length > 48) return false;
  const lower = t.toLowerCase();
  if (SKIP_WORDS.has(lower)) return false;
  if (/^\d+$/.test(t)) return false;
  // Non-ASCII / accented
  if (/[^\x00-\x7F]/.test(t)) return true;
  // CamelCase or glued brand
  if (/[a-z][A-Z]/.test(t) || /[A-Z]{2,}[a-z]/.test(t)) return true;
  // Hyphenated multi-part names
  if (/-/.test(t) && t.length >= 5) return true;
  // Likely proper noun (capitalized, not all-caps acronym of 2–3 letters)
  if (/^[A-Z][a-z]{2,}/.test(t) && !SKIP_WORDS.has(lower)) return true;
  // Longer uncommon words
  if (t.length >= 7 && !/^(company|business|limited|services)$/i.test(t)) {
    return true;
  }
  return false;
}

function extractProperChunks(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const out: string[] = [];

  // Multi-word Title Case runs: "Muindi Mbingu Street" → keep first 2–3 tokens if hard
  const titleRuns =
    raw.match(/\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){1,3})\b/g) || [];
  for (const run of titleRuns) {
    const words = run.split(/\s+/);
    const filtered = words.filter((w) => !SKIP_WORDS.has(w.toLowerCase()));
    if (filtered.length >= 2) {
      out.push(filtered.slice(0, 3).join(" "));
    } else if (filtered.length === 1 && looksHard(filtered[0])) {
      out.push(filtered[0]);
    }
  }

  // Single tokens
  for (const token of raw.split(/[^a-zA-Z0-9'’.-]+/)) {
    if (looksHard(token)) out.push(token.replace(/^[.-]+|[.-]+$/g, ""));
  }

  return out;
}

function pushUnique(
  map: Map<string, PronunciationSuggestion>,
  suggestion: PronunciationSuggestion
) {
  const key = suggestion.match.toLowerCase();
  const prev = map.get(key);
  if (!prev || suggestion.priority > prev.priority) {
    map.set(key, suggestion);
  }
}

function alreadyTrained(
  suggestion: { prompt: string; label: string; match: string },
  existing: TtsLexiconEntry[] | null | undefined
): boolean {
  if (!existing?.length) return false;
  const matchKey = suggestion.match.toLowerCase();
  const promptKey = normalizePhrase(suggestion.prompt);
  const labelKey = normalizePhrase(suggestion.label);
  return existing.some((e) => {
    if (e.match.trim().toLowerCase() === matchKey) return true;
    if (labelKey && normalizePhrase(e.label || "") === labelKey) return true;
    if (promptKey && normalizePhrase(e.say) === promptKey) return true;
    if (promptKey && normalizePhrase(e.label || "") === promptKey) return true;
    try {
      const source = e.match.startsWith("\\b")
        ? e.match
        : `\\b(?:${e.match})\\b`;
      const re = new RegExp(source, "i");
      if (re.test(suggestion.prompt) || re.test(suggestion.label)) return true;
    } catch {
      // ignore bad patterns
    }
    const matchPlain = normalizePhrase(
      e.match.replace(/\\[sb]|[+*?|()[\]]/g, " ")
    );
    return Boolean(promptKey && matchPlain && matchPlain === promptKey);
  });
}

/** Exported for coach UI status (done vs todo). */
export function isPronunciationCovered(
  suggestion: { prompt: string; label: string; match: string },
  existing: TtsLexiconEntry[] | null | undefined
): boolean {
  return alreadyTrained(suggestion, existing);
}

function normalizePhrase(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Suggest high-value words and short sentences from the business profile.
 */
export function suggestPronunciations(
  input: PronunciationSuggestInput
): PronunciationSuggestion[] {
  const map = new Map<string, PronunciationSuggestion>();
  const existing = input.existingLexicon || [];

  const businessName = String(input.businessName || "").trim();
  if (businessName && businessName.length >= 3) {
    const match = matchPatternFromPhrase(businessName);
    const word = {
      id: slugId("word", businessName),
      label: businessName,
      prompt: businessName,
      kind: "word" as const,
      reason: "Your business name — callers hear this first.",
      match,
      priority: 100,
    };
    if (match && !alreadyTrained(word, existing)) {
      pushUnique(map, word);
      const welcomeMatch = matchPatternFromPhrase(`Welcome to ${businessName}`);
      const welcome = {
        id: slugId("sentence", `welcome-${businessName}`),
        label: `Welcome line`,
        prompt: `Welcome to ${businessName}.`,
        kind: "sentence" as const,
        reason: "Practice the greeting the way you want it said.",
        match: welcomeMatch,
        priority: 85,
      };
      if (welcomeMatch && !alreadyTrained(welcome, existing)) {
        pushUnique(map, welcome);
      }
    }
  }

  const agentName = String(input.agentName || "").trim();
  if (
    agentName &&
    agentName.length >= 2 &&
    !/^receptionist$/i.test(agentName)
  ) {
    const match = matchPatternFromPhrase(agentName);
    const word = {
      id: slugId("word", agentName),
      label: agentName,
      prompt: agentName,
      kind: "word" as const,
      reason: "Receptionist name on every call.",
      match,
      priority: 98,
    };
    if (match && !alreadyTrained(word, existing)) {
      pushUnique(map, word);
      const introMatch = matchPatternFromPhrase(`this is ${agentName}`);
      const intro = {
        id: slugId("sentence", `agent-${agentName}`),
        label: "Name intro",
        prompt: `Hi, this is ${agentName}.`,
        kind: "sentence" as const,
        reason: "How the agent should say their own name.",
        match: introMatch,
        priority: 80,
      };
      if (introMatch && !alreadyTrained(intro, existing)) {
        pushUnique(map, intro);
      }
    }
  }

  for (const loc of input.locations || []) {
    const chunks = [
      ...extractProperChunks(loc.label || ""),
      ...extractProperChunks(loc.address || ""),
      ...extractProperChunks(loc.landmark || ""),
      ...extractProperChunks(loc.directions || ""),
    ];
    for (const chunk of chunks) {
      const match = matchPatternFromPhrase(chunk);
      const word = {
        id: slugId("word", chunk),
        label: chunk,
        prompt: chunk,
        kind: "word" as const,
        reason: "Place name from your locations.",
        match,
        priority: 92,
      };
      if (!match || alreadyTrained(word, existing)) continue;
      pushUnique(map, word);
    }
    const address = String(loc.address || "").trim();
    if (address && address.length >= 8 && address.length <= 90) {
      const hardBits = extractProperChunks(address);
      if (hardBits.length) {
        const sentence = address.replace(/\s+/g, " ").slice(0, 90);
        const sentenceMatch = matchPatternFromPhrase(sentence);
        const row = {
          id: slugId("sentence", sentence),
          label: "Address line",
          prompt: sentence.endsWith(".") ? sentence : `${sentence}.`,
          kind: "sentence" as const,
          reason: "Say your address the way locals say it.",
          match: sentenceMatch,
          priority: 78,
        };
        if (sentenceMatch && !alreadyTrained(row, existing)) {
          pushUnique(map, row);
        }
      }
    }
  }

  const locationNotes = String(input.locationNotes || "").trim();
  for (const chunk of extractProperChunks(locationNotes)) {
    const match = matchPatternFromPhrase(chunk);
    const word = {
      id: slugId("word", chunk),
      label: chunk,
      prompt: chunk,
      kind: "word" as const,
      reason: "From your location notes.",
      match,
      priority: 88,
    };
    if (!match || alreadyTrained(word, existing)) continue;
    pushUnique(map, word);
  }

  for (const member of input.team || []) {
    const name = String(member.name || "").trim();
    if (!name || name.length < 2) continue;
    const match = matchPatternFromPhrase(name);
    const word = {
      id: slugId("word", name),
      label: name,
      prompt: name,
      kind: "word" as const,
      reason: member.role
        ? `Team: ${String(member.role).trim()}`
        : "Team member name.",
      match,
      priority: looksHard(name.split(/\s+/)[0] || name) ? 90 : 70,
    };
    if (!match || alreadyTrained(word, existing)) continue;
    pushUnique(map, word);
  }

  for (const service of input.services || []) {
    const name = String(service.name || "").trim();
    if (!name || name.length < 3) continue;
    const chunks = extractProperChunks(name);
    const targets = chunks.length ? chunks : looksHard(name) ? [name] : [];
    for (const chunk of targets) {
      const match = matchPatternFromPhrase(chunk);
      const word = {
        id: slugId("word", chunk),
        label: chunk,
        prompt: chunk,
        kind: "word" as const,
        reason: "Service or product name.",
        match,
        priority: 75,
      };
      if (!match || alreadyTrained(word, existing)) continue;
      pushUnique(map, word);
    }
  }

  for (const faq of input.faqs || []) {
    for (const chunk of extractProperChunks(
      `${faq.question || ""} ${faq.answer || ""}`
    )) {
      const match = matchPatternFromPhrase(chunk);
      const word = {
        id: slugId("word", chunk),
        label: chunk,
        prompt: chunk,
        kind: "word" as const,
        reason: "From your FAQs.",
        match,
        priority: 72,
      };
      if (!match || alreadyTrained(word, existing)) continue;
      pushUnique(map, word);
    }
  }

  for (const bulletin of input.bulletinTexts || []) {
    for (const chunk of extractProperChunks(bulletin)) {
      const match = matchPatternFromPhrase(chunk);
      const word = {
        id: slugId("word", chunk),
        label: chunk,
        prompt: chunk,
        kind: "word" as const,
        reason: "From today’s bulletin.",
        match,
        priority: 68,
      };
      if (!match || alreadyTrained(word, existing)) continue;
      pushUnique(map, word);
    }
  }

  const all = [...map.values()].sort((a, b) => b.priority - a.priority);

  // Cap sentences so the coach stays focused.
  const words: PronunciationSuggestion[] = [];
  const sentences: PronunciationSuggestion[] = [];
  for (const item of all) {
    if (item.kind === "sentence") {
      if (sentences.length < SENTENCE_MAX) sentences.push(item);
    } else {
      words.push(item);
    }
  }

  return [...words, ...sentences]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, SUGGEST_MAX);
}
