/**
 * Per-row save on the owner desk. One id is pending; the others stay idle.
 * A save that would write the same Kiswahili name the row already holds does not fire.
 */

export type SwDecision = "approve" | "edit" | "reject";

export type SwNameFields = {
  name_sw: string | null;
  name_sw_state: string;
  name_sw_suggested: string | null;
};

export type SwPlan =
  | { fire: false; reason: "empty" | "unchanged" }
  | { fire: true; name_sw: string | null; name_sw_state: "approved" | "edited" | "rejected" };

export function markRowPending(pending: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (pending.has(id)) return pending;
  const next = new Set(pending);
  next.add(id);
  return next;
}

export function clearRowPending(pending: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!pending.has(id)) return pending;
  const next = new Set(pending);
  next.delete(id);
  return next;
}

export function rowIsPending(pending: ReadonlySet<string>, id: string): boolean {
  return pending.has(id);
}

/**
 * A settled row stays on screen while its own save is in flight (so only that
 * row can show pending) and leaves once the save lands. A failed save clears
 * both, which puts the row back.
 */
export function rowStillShown(id: string, settled: ReadonlySet<string>, pending: ReadonlySet<string>): boolean {
  return pending.has(id) || !settled.has(id);
}

export function planSwDecision(item: SwNameFields, decision: SwDecision, text?: string): SwPlan {
  if (decision === "approve") {
    const sw = (item.name_sw_suggested || "").trim();
    if (!sw) return { fire: false, reason: "empty" };
    if (item.name_sw_state === "approved" && (item.name_sw || "").trim() === sw) return { fire: false, reason: "unchanged" };
    return { fire: true, name_sw: sw, name_sw_state: "approved" };
  }
  if (decision === "edit") {
    const sw = String(text || "").trim().slice(0, 120);
    if (!sw) return { fire: false, reason: "empty" };
    if ((item.name_sw_state === "edited" || item.name_sw_state === "approved") && (item.name_sw || "").trim() === sw) {
      return { fire: false, reason: "unchanged" };
    }
    return { fire: true, name_sw: sw, name_sw_state: "edited" };
  }
  if (item.name_sw_state === "rejected" && !(item.name_sw || "").trim()) return { fire: false, reason: "unchanged" };
  return { fire: true, name_sw: null, name_sw_state: "rejected" };
}
