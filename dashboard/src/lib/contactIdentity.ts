/**
 * Keep in lockstep with src/conversation/contactIdentity.js
 */

const ALT_CAP = 5;

export function trimName(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

export function namesMatch(a: unknown, b: unknown): boolean {
  const left = trimName(a);
  const right = trimName(b);
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeAlternates(
  list: unknown,
  primary: string | null
): Array<{ name: string; seen_at: string | null; call_id: string | null }> {
  const seen = new Set<string>();
  const next: Array<{ name: string; seen_at: string | null; call_id: string | null }> = [];
  const primaryKey = trimName(primary)?.toLowerCase() || "";
  for (const row of Array.isArray(list) ? list : []) {
    const name = trimName((row as { name?: unknown })?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (primaryKey && key === primaryKey) continue;
    if (seen.has(key)) continue;
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
  const incomingName = trimName(incoming.name);
  const primary = trimName(existing?.name);
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
    name = incomingName;
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
