/**
 * Best-practice pronunciation packs for Train.
 * Fixed constructive lines (greeting / location / team) — not free-form AI spam.
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

function target(label: string): PronunciationTarget | null {
  const clean = String(label || "").trim();
  if (!clean || clean.length < 2) return null;
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
  const targets = opts.targets.filter((t) => t.label && t.match && !isBlockedMatch(t.match));
  if (!targets.length) return null;
  const prompt = opts.prompt.trim();
  if (prompt.length < 10 || prompt.length > 160) return null;
  return {
    id: opts.id,
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
 * Curated packs only — the reliable path for Kenyan receptionist training.
 * Prefer this over open-ended AI suggestion lists.
 */
export function buildPronunciationPacks(
  input: PronunciationPackInput
): PronunciationSuggestion[] {
  const existing = input.existingLexicon || [];
  const out: PronunciationSuggestion[] = [];

  const businessName = String(input.businessName || "").trim();
  const agentName = String(input.agentName || "").trim();
  const agentOk =
    agentName.length >= 2 && !/^receptionist$/i.test(agentName);

  const biz = businessName ? target(businessName) : null;
  const agent = agentOk ? target(agentName) : null;

  if (biz && agent) {
    const pack = line({
      id: "pack:greeting",
      label: "Greeting",
      prompt: `Hello, you've reached ${businessName}, this is ${agentName} speaking`,
      reason: "The first thing callers hear — trains business + agent name together.",
      targets: [biz, agent],
      priority: 100,
    });
    if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
  } else if (biz) {
    const pack = line({
      id: "pack:greeting-biz",
      label: "Greeting",
      prompt: `Thank you for calling ${businessName}`,
      reason: "Trains your business name on the greeting.",
      targets: [biz],
      priority: 98,
    });
    if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
  }

  const loc = (input.locations || []).find(
    (l) => String(l.address || "").trim() || String(l.landmark || "").trim()
  );
  if (loc) {
    const address = String(loc.address || "").trim();
    const landmark = String(loc.landmark || "").trim();
    // Pull 1–2 hard place chunks from address (Title Case runs), not every word.
    const placeLabels: string[] = [];
    const titleRuns =
      address.match(/\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,2})\b/g) || [];
    for (const run of titleRuns) {
      const t = target(run);
      if (t && !isTargetCovered(t, existing)) placeLabels.push(t.label);
      if (placeLabels.length >= 2) break;
    }
    if (landmark) {
      const landmarkCore = landmark.split(",")[0].trim();
      const t = target(landmarkCore);
      if (t && !isTargetCovered(t, existing) && placeLabels.length < 2) {
        placeLabels.push(t.label);
      }
    }
    const targets = placeLabels
      .map((l) => target(l))
      .filter(Boolean) as PronunciationTarget[];

    if (targets.length) {
      const placeBit = targets[0].label;
      const nearBit = targets[1]?.label;
      const prompt = nearBit
        ? `We're on ${placeBit}, near ${nearBit}`
        : `We're on ${placeBit}`;
      const pack = line({
        id: "pack:location",
        label: "Location",
        prompt,
        reason: "Only the hard place names — not every English word in the address.",
        targets,
        priority: 92,
      });
      if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
    }
  }

  const teamNames = (input.team || [])
    .map((m) => String(m.name || "").trim())
    .filter((n) => n.length >= 2)
    .slice(0, 2);
  const teamTargets = teamNames
    .map((n) => target(n))
    .filter((t): t is PronunciationTarget => Boolean(t && !isTargetCovered(t, existing)));

  if (teamTargets.length) {
    const prompt =
      teamTargets.length === 1
        ? `I can have ${teamTargets[0].label} follow up with you`
        : `I can have ${teamTargets[0].label} or ${teamTargets[1].label} follow up with you`;
    const pack = line({
      id: "pack:team",
      label: "Team",
      prompt,
      reason: "Team names for transfers and callbacks.",
      targets: teamTargets,
      priority: 88,
    });
    if (pack && !isPronunciationCovered(pack, existing)) out.push(pack);
  }

  return out.sort((a, b) => b.priority - a.priority);
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
