/** Add many undo: pure helpers shared by the server log and the Catalogue bar. kb_undo_import enforces the same 10 minutes in SQL. */
export const IMPORT_UNDO_WINDOW_MS = 10 * 60 * 1000;
export type ImportSource = "paste" | "file" | "photo" | "url";

export function importSource(v: unknown): ImportSource {
  return v === "file" || v === "photo" || v === "url" ? v : "paste";
}

/** Whole minutes left in the undo window, rounded up, so "1 minute" shows until the very end. */
export function undoMinutesLeft(at: number, now: number): number {
  return Math.max(0, Math.ceil((at + IMPORT_UNDO_WINDOW_MS - now) / 60_000));
}

/** Owner words for each way undo can be refused. */
export function undoErrorMessage(code: string | undefined): string {
  if (code === "22023") return "It's been more than 10 minutes, so this import can't be undone. Edit the items instead.";
  if (code === "40001") return "Some of these items were changed after the import, so undo is off. Edit them instead.";
  if (code === "P0002") return "We couldn't find that import.";
  return "Couldn't undo. Nothing was changed. Try again.";
}

// ---------- Found facts saved in the same import (hours, policies, payment, address, branches, areas, FAQs) ----------

/** Where each card kind saves. Policies and payment share business_policies; the areas save also rewrites its coverage mirror there. */
export type FactKey = "hours" | "policies" | "locations" | "faqs" | "areas";
export type FactState = Partial<Record<FactKey, unknown>>;

const KEY_OF: Record<string, FactKey[]> = {
  hours: ["hours"],
  policy: ["policies"],
  payment: ["policies"],
  address: ["locations"],
  branch: ["locations"],
  faq: ["faqs"],
  areas: ["areas", "policies"],
};

/** The stored facts a set of cards can change. */
export function factKeysFor(kinds: string[]): FactKey[] {
  return [...new Set(kinds.flatMap((k) => KEY_OF[k] ?? []))];
}

/** Bookkeeping keys a save may stamp without the owner changing anything. */
const VOLATILE = new Set(["provenance", "updated_at", "updatedAt"]);
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .filter((k) => !VOLATILE.has(k))
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  }
  return v ?? null;
}
export const sameFact = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** Facts changed since the import saved them (nothing recorded counts as unchanged). */
export function factsChangedSince(after: FactState, current: FactState): FactKey[] {
  return (Object.keys(after) as FactKey[]).filter((k) => !sameFact(after[k], current[k]));
}

/** First write wins for before (the state before the whole import); later writes win for after. */
export function mergeFactLog(
  prev: { before?: FactState | null; after?: FactState | null },
  before: FactState,
  after: FactState,
): { before: FactState; after: FactState } {
  const keys = (Object.keys(after) as FactKey[]).filter((k) => !sameFact(before[k], after[k]) || (prev.after && k in prev.after));
  const b: FactState = { ...(prev.before || {}) };
  const a: FactState = { ...(prev.after || {}) };
  for (const k of keys) {
    if (!(k in b)) b[k] = before[k] ?? null;
    a[k] = after[k] ?? null;
  }
  return { before: b, after: a };
}

/** Restore order: areas first (their save rewrites the coverage mirror inside policies), then policies, then the rest. */
export const FACT_RESTORE_ORDER: FactKey[] = ["areas", "policies", "hours", "locations", "faqs"];

export const FACTS_CHANGED_MESSAGE = "Some details from this import were changed after it, so undo is off. Edit them instead.";
