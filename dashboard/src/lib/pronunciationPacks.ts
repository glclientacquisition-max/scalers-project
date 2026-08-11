/**
 * Best-practice pronunciation packs for Train.
 * At most one Greeting, one Location, one Team — each a logical receptionist line.
 */

import {
  isBlockedMatch,
  matchPatternFromPhrase,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  isPronunciationCovered,
  isTargetCovered,
  type PronunciationSuggestion,
  type PronunciationTarget,
} from "@/lib/pronunciationSuggest";

export type PronunciationPackInput = {
  businessName?: string | null;
  agentName?: string | null;
  locations?: Array<{
    label?: string;
    address?: string;
    landmark?: string;
  }> | null;
  team?: Array<{ name?: string; role?: string }> | null;
  existingLexicon?: TtsLexiconEntry[] | null;
};

const FILLER_PLACE = new Set(
  [
    "shop",
    "no",
    "number",
    "main",
    "branch",
    "store",
    "cbd",
    "nairobi",
    "kenya",
    "street",
    "road",
    "avenue",
    "opposite",
    "near",
    "located",
  ].map((w) => w.toLowerCase())
);

function normalizeKey(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function target(label: string): PronunciationTarget | null {
  const clean = String(label || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!clean || clean.length < 2 || clean.length > 60) return null;
  // Skip shop numbers / filler fragments ("Shop No", "M4" alone is ok for Em-for but skip tiny)
  const words = clean.split(" ");
  if (words.every((w) => FILLER_PLACE.has(w.toLowerCase()) || /^[A-Z]?\.?\d+$/i.test(w))) {
    return null;
  }
  const match = matchPatternFromPhrase(clean);
  if (!match || isBlockedMatch(match)) return null;
  return { label: clean, match };
}

function line(opts: {
  id: string;
  label: string;
  prompt: string;
  reason: string;
  targets: PronunciationTarget[];
  priority: number;
}): PronunciationSuggestion | null {
  const targets = opts.targets.filter(
    (t) => t.label && t.match && !isBlockedMatch(t.match)
  );
  if (!targets.length) return null;
  let prompt = opts.prompt.trim().replace(/\s+/g, " ");
  if (prompt.length < 12 || prompt.length > 160) return null;
  // Must contain each target label so the line is logically about those names.
  for (const t of targets) {
    if (!prompt.toLowerCase().includes(t.label.toLowerCase())) return null;
  }
  if (!/[.?!]$/.test(prompt)) prompt = `${prompt}.`;
  return {
    id: opts.id,
    label: opts.label,
    prompt,
    kind: "sentence",
    reason: opts.reason,
    targets,
    match: targets[0].match,
    priority: opts.priority,
  };
}

/** Prefer a street-like title run from an address line. */
function extractStreetLabel(address: string): string | null {
  const raw = String(address || "").trim();
  if (!raw) return null;
  // "Muindi Mbingu Street, Shop No. M4, Nairobi CBD" → first clause
  const firstClause = raw.split(",")[0].trim();
  const runs =
    firstClause.match(/\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,3})\b/g) ||
    [];
  for (const run of runs) {
    const words = run.split(/\s+/);
    const useful = words.filter((w) => !FILLER_PLACE.has(w.toLowerCase()));
    // Keep street suffix if present for natural speech
    if (useful.length >= 1) {
      const t = target(run);
      if (t) return t.label;
    }
  }
  const fallback = target(firstClause);
  return fallback?.label || null;
}

function extractLandmarkLabel(landmark: string): string | null {
  const core = String(landmark || "")
    .trim()
    .split(",")[0]
    .trim()
    .replace(/^(opposite|near|next to|beside)\s+/i, "");
  if (!core) return null;
  const t = target(core);
  return t?.label || null;
}

/**
 * At most three packs: Greeting, Location, Team.
 * No duplicate prompts; each target trained in at most one pack.
 */
export function buildPronunciationPacks(
  input: PronunciationPackInput
): PronunciationSuggestion[] {
  const existing = input.existingLexicon || [];
  const out: PronunciationSuggestion[] = [];
  const usedTargetKeys = new Set<string>();

  function claimTargets(targets: PronunciationTarget[]): PronunciationTarget[] {
    const claimed: PronunciationTarget[] = [];
    for (const t of targets) {
      const key = normalizeKey(t.label);
      if (!key || usedTargetKeys.has(key)) continue;
      if (isTargetCovered(t, existing)) continue;
      usedTargetKeys.add(key);
      claimed.push(t);
    }
    return claimed;
  }

  const businessName = String(input.businessName || "").trim();
  const agentName = String(input.agentName || "").trim();
  const agentOk =
    agentName.length >= 2 && !/^receptionist$/i.test(agentName);

  const biz = businessName ? target(businessName) : null;
  const agent = agentOk ? target(agentName) : null;

  // --- Greeting (exactly one) ---
  if (biz && agent) {
    const targets = claimTargets([biz, agent]);
    if (targets.length) {
      const pack = line({
        id: "pack:greeting",
        label: "Greeting",
        prompt: `Hello, you've reached ${businessName}, this is ${agentName} speaking`,
        reason: "Opening line callers hear first — business name and agent name.",
        targets,
        priority: 100,
      });
      if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
    }
  } else if (biz) {
    const targets = claimTargets([biz]);
    if (targets.length) {
      const pack = line({
        id: "pack:greeting",
        label: "Greeting",
        prompt: `Thank you for calling ${businessName}`,
        reason: "Opening line — trains your business name.",
        targets,
        priority: 98,
      });
      if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
    }
  }

  // --- Location (exactly one) ---
  const loc = (input.locations || []).find(
    (l) => String(l.address || "").trim() || String(l.landmark || "").trim()
  );
  if (loc) {
    const street = extractStreetLabel(String(loc.address || ""));
    const landmark = extractLandmarkLabel(String(loc.landmark || ""));
    const locTargets = claimTargets(
      [street, landmark]
        .filter(Boolean)
        .map((l) => target(l as string))
        .filter(Boolean) as PronunciationTarget[]
    );

    if (locTargets.length) {
      const hasStreet = street && locTargets.some((t) => t.label === street);
      const hasLandmark =
        landmark && locTargets.some((t) => t.label === landmark);
      let prompt = "";
      if (hasStreet && hasLandmark) {
        prompt = `We're on ${street}, opposite ${landmark}`;
      } else if (hasStreet) {
        prompt = `We're on ${street}`;
      } else if (hasLandmark) {
        prompt = `You'll find us opposite ${landmark}`;
      } else {
        prompt = `We're at ${locTargets[0].label}`;
      }

      const pack = line({
        id: "pack:location",
        label: "Location",
        prompt,
        reason: "One clear place line — only hard place names are learned.",
        targets: locTargets,
        priority: 92,
      });
      if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
    }
  }

  // --- Team (exactly one) — skip names already used as agent ---
  const agentKey = normalizeKey(agentName);
  const teamNames = (input.team || [])
    .map((m) => String(m.name || "").trim())
    .filter((n) => n.length >= 2 && normalizeKey(n) !== agentKey)
    .slice(0, 2);
  const teamTargets = claimTargets(
    teamNames.map((n) => target(n)).filter(Boolean) as PronunciationTarget[]
  );

  if (teamTargets.length) {
    const prompt =
      teamTargets.length === 1
        ? `I can have ${teamTargets[0].label} follow up with you`
        : `I can have ${teamTargets[0].label} or ${teamTargets[1].label} follow up with you`;
    const pack = line({
      id: "pack:team",
      label: "Team",
      prompt,
      reason: "Callback / transfer line — team names only.",
      targets: teamTargets,
      priority: 88,
    });
    if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
  }

  // Final de-dupe by prompt text (safety net — should already be unique by id).
  const seenPrompts = new Set<string>();
  const unique: PronunciationSuggestion[] = [];
  for (const pack of out.sort((a, b) => b.priority - a.priority)) {
    const key = normalizeKey(pack.prompt);
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    unique.push(pack);
  }
  return unique.slice(0, 3);
}

/**
 * Apply tenant lexicon to a sample line for desk preview (mirrors voice applyLexicon).
 */
export function previewSpokenLine(
  text: string,
  lexicon: TtsLexiconEntry[]
): string {
  let out = String(text || "").replace(/\s+/g, " ").trim();
  if (!out) return "";

  const compiled = [...lexicon]
    .map((entry, index) => {
      const source = entry.match.startsWith("\\b")
        ? entry.match
        : `\\b(?:${entry.match})\\b`;
      try {
        return {
          ...entry,
          priority: entry.priority ?? 200,
          index,
          re: new RegExp(source, "gi"),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<
    TtsLexiconEntry & { priority: number; index: number; re: RegExp }
  >;

  compiled.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.match.length - a.match.length ||
      a.index - b.index
  );

  for (const entry of compiled) {
    out = out.replace(entry.re, entry.say);
  }
  return out;
}
