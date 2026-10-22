import { isReceptionistInstruction } from "./provenance";

/**
 * Owner-facing display of old free-text policy lines (Desk only).
 * Never changes what is stored or what reaches calls: Brain reads the raw field.
 */

const SUMMARY_MAX = 120;

/**
 * The owner's old line, tidied for display or as a pre-filled note.
 * Null when there is nothing an owner should read: empty, or an instruction
 * written for the assistant ("the receptionist should route the caller…").
 */
export function cleanLegacyPolicyText(text: unknown): string | null {
  let t = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.\-–—]+/, "")
    .trim();
  if (!t) return null;
  if (isReceptionistInstruction(t)) return null;
  t = t
    .replace(/^(?:old text|notes?)\s*:\s*/i, "")
    .replace(/(?<!\.)\.{2}(?!\.)/g, ".")
    .replace(/\s+([.,;!?])/g, "$1")
    .trim();
  return t || null;
}

/** One short line for a row: our product name, ends in one full stop, trimmed to fit. */
export function ownerPolicySummary(text: unknown): string | null {
  const clean = cleanLegacyPolicyText(text);
  if (!clean) return null;
  let t = clean.replace(/\b(?:the |our |your )?receptionist\b/gi, (m) => {
    const lead = /^(?:the|our|your) /i.exec(m)?.[0] ?? "";
    return lead ? "your Business Assistant" : "Business Assistant";
  });
  if (t.length > SUMMARY_MAX) t = `${t.slice(0, SUMMARY_MAX - 1).replace(/[\s,;:.]+\S*$/, "")}…`;
  if (!/[.!?…]$/.test(t)) t += ".";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Tap" only where the owner taps. Unknown (server render) gets a verb-free line. */
export function setUpHint(pointer: "coarse" | "fine" | null): string {
  if (pointer === "coarse") return "Tap to set it up.";
  if (pointer === "fine") return "Click to set it up.";
  return "Not set up yet.";
}

/** Row text for a rule that only has an old line. */
export function legacyRuleRowText(text: unknown, pointer: "coarse" | "fine" | null): string {
  const summary = ownerPolicySummary(text);
  return summary ? `${summary} ${setUpHint(pointer)}` : setUpHint(pointer);
}
