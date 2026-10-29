/**
 * Maps owner billing RPC JSON to Desk plan/seat action state.
 * Pure: safe for tests without Supabase.
 */

export type PlanActionState =
  | { ok: true; message?: string }
  | { ok: false; message?: string; error?: string; denied?: boolean };

const CLOSED_MESSAGE = "Plan changes open soon";

export function planChangesClosed(): PlanActionState {
  return { ok: false, message: CLOSED_MESSAGE };
}

export function planActionFromRpc(result: unknown): PlanActionState {
  if (!result || typeof result !== "object") {
    return { ok: false, error: "That change did not save. Try again." };
  }
  const row = result as Record<string, unknown>;
  if (row.ok === true) {
    const message = String(row.message || "").trim();
    return message ? { ok: true, message } : { ok: true };
  }
  const message = String(row.message || "").trim();
  const code = String(row.code || "");
  if (code === "disabled" || code === "production_refused") {
    return planChangesClosed();
  }
  if (message) return { ok: false, error: message };
  return { ok: false, error: "That change did not save. Try again." };
}
