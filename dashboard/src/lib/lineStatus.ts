/**
 * Receptionist line chip. Never invent "Online".
 * DID + compile readiness only (docs/frontend/FRONTEND_CONSTITUTION.md).
 */

export type LineStatusId = "live" | "pending" | "needs_training";

export function resolveLineStatus(
  did: string | null | undefined,
  ready: boolean
): LineStatusId {
  const value = String(did || "").trim();
  if (!value) return "needs_training";
  if (/^pending:/i.test(value)) return "pending";
  if (!ready) return "needs_training";
  return "live";
}

export function lineStatusLabel(id: LineStatusId): string {
  if (id === "live") return "Line live";
  if (id === "pending") return "Number pending";
  return "Needs training";
}
