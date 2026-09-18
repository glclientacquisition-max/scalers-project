/**
 * Keep in lockstep with src/conversation/contactIdentity.js
 */

import {
  compactNameKey,
  namesLikelySame,
  preferredContactSpelling,
} from "./callerNameMatch";
import { isJunkCallerName } from "./callerNameQuality";
import { normalizeKenyaE164 } from "./handoffMode";

export const ALT_CAP = 5;

export function trimName(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

export function namesMatch(a: unknown, b: unknown): boolean {
  return namesLikelySame(a, b);
}

/** Same contract as src/db.js: Kenya E.164, else trimmed original. */
export function normalizeStoredPhone(raw: unknown): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

/**
 * Writer parse for live persist, CSV, and manual UI.
 * Empty and "unknown" are not a phone file. Kenya variants become E.164.
 * Non-Kenya numbers keep the trimmed original, matching live call writes.
 */
export function parseStoredContactPhone(
  raw: unknown
): { ok: true; phone: string } | { ok: false; error: string } {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return { ok: false, error: "Phone is required." };
  }
  const phone = normalizeStoredPhone(trimmed);
  if (!phone) return { ok: false, error: "Phone is required." };
  return { ok: true, phone };
}

function normalizeAlternates(
  list: unknown,
  primary: string | null
): Array<{ name: string; seen_at: string | null; call_id: string | null }> {
  const seen = new Set<string>();
  const next: Array<{ name: string; seen_at: string | null; call_id: string | null }> =
    [];
  for (const row of Array.isArray(list) ? list : []) {
    const name = trimName((row as { name?: unknown })?.name);
    if (!name || isJunkCallerName(name)) continue;
    if (primary && namesMatch(name, primary)) continue;
    const key = compactNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({
      name,
      seen_at: (row as { seen_at?: string | null }).seen_at || null,
      call_id: (row as { call_id?: string | null }).call_id || null,
    });
    if (next.length >= ALT_CAP) break;
  }
  return next;
}

export function mergeContactIdentity(
  existing: { name?: string | null; metadata?: Record<string, unknown> | null } | null,
  incoming: { name?: unknown; seenAt?: string; callId?: string | null } = {}
): { name: string | null; metadata: Record<string, unknown> } {
  const incomingName = isJunkCallerName(incoming.name)
    ? null
    : trimName(incoming.name);
  const primary = isJunkCallerName(existing?.name)
    ? null
    : trimName(existing?.name);
  const baseMeta =
    existing?.metadata &&
    typeof existing.metadata === "object" &&
    !Array.isArray(existing.metadata)
      ? { ...existing.metadata }
      : {};
  const alternates = Array.isArray(baseMeta.alternate_names)
    ? [...(baseMeta.alternate_names as unknown[])]
    : [];

  let name = primary;
  if (incomingName && !primary) {
    name = preferredContactSpelling(incomingName, incomingName) || incomingName;
  } else if (incomingName && primary && namesMatch(incomingName, primary)) {
    name = preferredContactSpelling(primary, incomingName) || primary;
  } else if (incomingName && primary && !namesMatch(incomingName, primary)) {
    const already = alternates.some((row) =>
      namesMatch((row as { name?: unknown })?.name, incomingName)
    );
    if (!already) {
      alternates.unshift({
        name: incomingName,
        seen_at: incoming.seenAt || new Date().toISOString(),
        call_id: incoming.callId || null,
      });
    }
  }

  return {
    name,
    metadata: {
      ...baseMeta,
      alternate_names: normalizeAlternates(alternates, name),
    },
  };
}
