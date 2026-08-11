/**
 * Auto-suggest constructive pronunciation lines (sentences), not isolated words.
 * Deterministic first pass; Gemini screening (optional) drops obvious / low-value items.
 */

import {
  matchPatternFromPhrase,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";

export type PronunciationTarget = {
  label: string;
  match: string;
};

export type PronunciationSuggestion = {
  id: string;
  label: string;
  /** Full constructive line the owner should say out loud. */
  prompt: string;
  kind: "sentence";
  reason: string;
  /** Hard names/places covered by this one recording. */
  targets: PronunciationTarget[];
  /** Primary match (first target) — used for list keys. */
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
  existingLexicon?: TtsLexiconEntry[] | null;
};

const SUGGEST_MAX = 5;

/** Words / phrases we never ask owners to record alone (too obvious). */
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
    "cbd",
    "mall",
    "market",
    "fashion",
    "bookstore",
    "books",
    "receptionist",
    "manager",
    "owner",
    "customer",
    "call",
    "phone",
    "whatsapp",
    "email",
    "welcome",
    "located",
    "opposite",
    "delivery",
    "shipping",
    "countrywide",
    "same",
    "day",
    "within",
    "across",
    "number",
    "no",
  ].map((w) => w.toLowerCase())
);

function slugId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
  return `line:${slug || "item"}`;
}

function normalizePhrase(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function looksHard(token: string): boolean {
  const t = token.trim();
  if (t.length < 3 || t.length > 48) return false;
  const lower = t.toLowerCase();
  if (SKIP_WORDS.has(lower)) return false;
  if (/^\d+$/.test(t)) return false;
  if (/[^\x00-\x7F]/.test(t)) return true;
  if (/[a-z][A-Z]/.test(t) || /[A-Z]{2,}[a-z]/.test(t)) return true;
  if (/-/.test(t) && t.length >= 5) return true;
  if (/^[A-Z][a-z]{2,}/.test(t) && !SKIP_WORDS.has(lower)) return true;
  // Require stronger signal than “long English word”
  if (
    t.length >= 8 &&
    /[aeiou].*[aeiou]/i.test(t) &&
    !/^(company|business|limited|services|bookstore|shopping)$/i.test(t)
  ) {
    // Still skip if it looks like plain English (no unusual consonant clusters / names)
    if (/^(delivery|opposite|located|fashion|shipping|countrywide)$/i.test(t)) {
      return false;
    }
  }
  return false;
}

function extractProperChunks(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const out: string[] = [];

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

  for (const token of raw.split(/[^a-zA-Z0-9'’.-]+/)) {
    if (looksHard(token)) out.push(token.replace(/^[.-]+|[.-]+$/g, ""));
  }

  return out;
}

function uniqueTargets(
  labels: string[],
  existing: TtsLexiconEntry[]
): PronunciationTarget[] {
  const seen = new Set<string>();
  const out: PronunciationTarget[] = [];
  for (const label of labels) {
    const clean = String(label || "").trim();
    if (!clean) continue;
    const match = matchPatternFromPhrase(clean);
    if (!match) continue;
    const key = normalizePhrase(clean);
    if (!key || seen.has(key)) continue;
    if (isTargetCovered({ label: clean, match }, existing)) continue;
    seen.add(key);
    out.push({ label: clean, match });
  }
  return out;
}

export function isTargetCovered(
  target: PronunciationTarget,
  existing: TtsLexiconEntry[] | null | undefined
): boolean {
  if (!existing?.length) return false;
  const matchKey = target.match.toLowerCase();
  const labelKey = normalizePhrase(target.label);
  return existing.some((e) => {
    if (e.match.trim().toLowerCase() === matchKey) return true;
    if (labelKey && normalizePhrase(e.label || "") === labelKey) return true;
    if (labelKey && normalizePhrase(e.say) === labelKey) return true;
    try {
      const source = e.match.startsWith("\\b")
        ? e.match
        : `\\b(?:${e.match})\\b`;
      const re = new RegExp(source, "i");
      if (re.test(target.label)) return true;
    } catch {
      // ignore
    }
    return false;
  });
}

/** A line is done when every hard target is already in the lexicon. */
export function isPronunciationCovered(
  suggestion: Pick<PronunciationSuggestion, "prompt" | "label" | "match" | "targets">,
  existing: TtsLexiconEntry[] | null | undefined
): boolean {
  const targets =
    Array.isArray(suggestion.targets) && suggestion.targets.length
      ? suggestion.targets
      : [{ label: suggestion.label, match: suggestion.match }];
  return targets.every((t) => isTargetCovered(t, existing));
}

function makeLine(opts: {
  prompt: string;
  label: string;
  reason: string;
  targets: PronunciationTarget[];
  priority: number;
}): PronunciationSuggestion | null {
  const targets = opts.targets.filter((t) => t.label && t.match);
  if (!targets.length) return null;
  const prompt = opts.prompt.trim();
  if (prompt.length < 8 || prompt.length > 200) return null;
  return {
    id: slugId(prompt),
    label: opts.label,
    prompt: /[.?!]$/.test(prompt) ? prompt : `${prompt}.`,
    kind: "sentence",
    reason: opts.reason,
    targets,
    match: targets[0].match,
    priority: opts.priority,
  };
}

/**
 * Deterministic constructive lines from the business profile.
 * Prefer natural receptionist sentences that pack hard names together.
 */
export function suggestPronunciations(
  input: PronunciationSuggestInput
): PronunciationSuggestion[] {
  const existing = input.existingLexicon || [];
  const lines: PronunciationSuggestion[] = [];

  const businessName = String(input.businessName || "").trim();
  const agentName = String(input.agentName || "").trim();
  const agentOk =
    agentName.length >= 2 && !/^receptionist$/i.test(agentName);

  const bizTargets = businessName
    ? uniqueTargets([businessName], existing)
    : [];
  const agentTargets = agentOk ? uniqueTargets([agentName], existing) : [];

  if (bizTargets.length && agentTargets.length) {
    const line = makeLine({
      prompt: `Hi, this is ${agentName} from ${businessName}`,
      label: "Greeting",
      reason: "One line trains both your agent name and business name.",
      targets: [...agentTargets, ...bizTargets],
      priority: 100,
    });
    if (line) lines.push(line);
  } else if (bizTargets.length) {
    const line = makeLine({
      prompt: `Thank you for calling ${businessName}`,
      label: "Business name",
      reason: "Callers hear your business name first.",
      targets: bizTargets,
      priority: 98,
    });
    if (line) lines.push(line);
  } else if (agentTargets.length) {
    const line = makeLine({
      prompt: `Hi, this is ${agentName}. How can I help you today`,
      label: "Agent intro",
      reason: "How the receptionist says their own name.",
      targets: agentTargets,
      priority: 96,
    });
    if (line) lines.push(line);
  }

  for (const loc of input.locations || []) {
    const placeChunks = [
      ...extractProperChunks(loc.address || ""),
      ...extractProperChunks(loc.landmark || ""),
      ...extractProperChunks(loc.label || ""),
    ];
    const placeTargets = uniqueTargets(placeChunks, existing).slice(0, 3);
    if (!placeTargets.length) continue;

    const landmark = String(loc.landmark || "").trim();
    const address = String(loc.address || "").trim();
    let prompt = "";
    if (placeTargets.length >= 2) {
      prompt = `We're on ${placeTargets[0].label}, near ${placeTargets[1].label}`;
    } else if (landmark && /[A-Za-z]/.test(landmark)) {
      prompt = `We're on ${placeTargets[0].label}, opposite ${landmark.split(",")[0].trim()}`;
    } else if (address) {
      prompt = `Our shop is on ${placeTargets[0].label}`;
    } else {
      prompt = `You can find us at ${placeTargets[0].label}`;
    }

    // Landmark may introduce obvious words — keep targets as the hard chunks only
    const line = makeLine({
      prompt,
      label: "Location",
      reason: "Practice the place names callers ask for.",
      targets: placeTargets,
      priority: 92,
    });
    if (line) lines.push(line);
    break; // one strong location line is enough from deterministic pass
  }

  const teamNames = (input.team || [])
    .map((m) => String(m.name || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const teamTargets = uniqueTargets(teamNames, existing).slice(0, 2);
  if (teamTargets.length) {
    const prompt =
      teamTargets.length === 1
        ? `You can ask for ${teamTargets[0].label}`
        : `You can ask for ${teamTargets[0].label} or ${teamTargets[1].label}`;
    const line = makeLine({
      prompt,
      label: "Team",
      reason: "Team names must sound right on transfers.",
      targets: teamTargets,
      priority: 88,
    });
    if (line) lines.push(line);
  }

  const serviceChunks: string[] = [];
  for (const service of input.services || []) {
    serviceChunks.push(...extractProperChunks(service.name || ""));
  }
  const serviceTargets = uniqueTargets(serviceChunks, existing).slice(0, 2);
  if (serviceTargets.length) {
    const prompt =
      serviceTargets.length === 1
        ? `We also stock ${serviceTargets[0].label}`
        : `We also stock ${serviceTargets[0].label} and ${serviceTargets[1].label}`;
    const line = makeLine({
      prompt,
      label: "Products",
      reason: "Product names that trip up TTS.",
      targets: serviceTargets,
      priority: 80,
    });
    if (line) lines.push(line);
  }

  // Skip FAQ/bulletin "just to confirm" filler lines — they sounded unnatural.

  const dedup = new Map<string, PronunciationSuggestion>();
  for (const line of lines) {
    if (isPronunciationCovered(line, existing)) continue;
    const key = line.id;
    const prev = dedup.get(key);
    if (!prev || line.priority > prev.priority) dedup.set(key, line);
  }

  return [...dedup.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, SUGGEST_MAX);
}

/** Candidate hard labels for AI screening (no sentences yet). */
export function collectHardNameCandidates(
  input: PronunciationSuggestInput
): string[] {
  const existing = input.existingLexicon || [];
  const labels: string[] = [];
  if (input.businessName) labels.push(String(input.businessName));
  if (input.agentName && !/^receptionist$/i.test(String(input.agentName))) {
    labels.push(String(input.agentName));
  }
  for (const loc of input.locations || []) {
    labels.push(
      ...extractProperChunks(loc.label || ""),
      ...extractProperChunks(loc.address || ""),
      ...extractProperChunks(loc.landmark || ""),
      ...extractProperChunks(loc.directions || "")
    );
  }
  labels.push(...extractProperChunks(String(input.locationNotes || "")));
  for (const member of input.team || []) {
    if (member.name) labels.push(String(member.name));
  }
  for (const service of input.services || []) {
    labels.push(...extractProperChunks(service.name || ""));
  }
  for (const faq of input.faqs || []) {
    labels.push(
      ...extractProperChunks(`${faq.question || ""} ${faq.answer || ""}`)
    );
  }
  for (const bulletin of input.bulletinTexts || []) {
    labels.push(...extractProperChunks(bulletin));
  }

  return uniqueTargets(labels, existing).map((t) => t.label).slice(0, 24);
}

export function parseSuggestionList(raw: unknown): PronunciationSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PronunciationSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const prompt = String(row.prompt || "").trim();
    const label = String(row.label || "Line").trim() || "Line";
    const reason = String(row.reason || "Trains hard names in a natural line.").trim();
    const targetLabels = Array.isArray(row.targets)
      ? row.targets.map((t) =>
          typeof t === "string"
            ? t
            : t && typeof t === "object"
              ? String((t as { label?: string }).label || "")
              : ""
        )
      : [];
    const targets = uniqueTargets(
      targetLabels.filter(Boolean),
      []
    );
    // If AI omitted targets, derive from prompt-ish labels listed
    const line = makeLine({
      prompt,
      label,
      reason,
      targets:
        targets.length > 0
          ? targets
          : uniqueTargets(
              extractProperChunks(prompt).slice(0, 3),
              []
            ),
      priority: Number(row.priority) > 0 ? Number(row.priority) : 85,
    });
    if (line) out.push(line);
  }
  return out.slice(0, SUGGEST_MAX);
}
