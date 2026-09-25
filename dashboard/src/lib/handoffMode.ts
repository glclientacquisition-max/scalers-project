export type HandoffMode = "callback" | "live_transfer";

export const HANDOFF_OPTIONS: {
  id: HandoffMode;
  label: string;
  blurb: string;
}[] = [
  {
    id: "callback",
    label: "Message teammate",
    blurb: "AI stays on the line. SMS, WhatsApp, or email.",
  },
  {
    id: "live_transfer",
    label: "Connect live call",
    blurb: "Messages a teammate.",
  },
];

/** Kenya mobile to E.164. Desk readiness only; Voice has the same helper. */
export function normalizeKenyaE164(raw: unknown): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`;
  }
  if (!/^254\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

/** Same contract as src/db.js: Kenya E.164, else trimmed original. */
export function normalizeStoredPhone(raw: unknown): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

/** Stable join key so +254… and 254… match until dirty rows are backfilled. */
export function storedPhoneJoinKey(raw: unknown): string | null {
  return normalizeKenyaE164(raw) || normalizeStoredPhone(raw);
}

/**
 * Query/lookup variants for one Kenya mobile. Write path still stores E.164.
 * Includes the national 254 form so old dirty rows still join.
 */
export function storedPhoneCandidates(raw: unknown): string[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const e164 = normalizeKenyaE164(trimmed);
  const stored = normalizeStoredPhone(trimmed);
  for (const phone of [trimmed, stored, e164, e164 ? e164.slice(1) : null]) {
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

export function teamHasDialablePhone(
  team: Array<{ phone?: string | null }> | null | undefined
): boolean {
  return (team || []).some((row) => Boolean(normalizeKenyaE164(row?.phone)));
}

export function firstDialableTeammate(
  team: Array<{ name?: string | null; phone?: string | null }> | null | undefined
): { name: string; phone: string } | null {
  for (const row of team || []) {
    const phone = normalizeKenyaE164(row?.phone);
    if (phone) {
      return { name: String(row?.name || "").trim() || "teammate", phone };
    }
  }
  return null;
}

export function parseHandoffMode(raw: unknown): HandoffMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "live_transfer" || v === "livetransfer" || v === "transfer") {
    return "live_transfer";
  }
  return "callback";
}
