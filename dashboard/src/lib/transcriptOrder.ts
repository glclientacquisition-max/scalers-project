/**
 * Transcript turn order. Rows written in the same millisecond (greeting and the
 * caller's first words) sorted by created_at alone showed the greeting after
 * the caller (owner review, 18 Oct 2026). Voice is adding transcripts.seq
 * (0-based turn index, nullable): sort by seq asc nulls last, then created_at,
 * then id. Relative imports only, so node tests load it directly.
 */
export type OrderedTurn = { id?: string | null; created_at?: string | null; seq?: number | null };

export function compareTranscriptTurns(a: OrderedTurn, b: OrderedTurn): number {
  const as = typeof a.seq === "number" && Number.isFinite(a.seq) ? a.seq : null;
  const bs = typeof b.seq === "number" && Number.isFinite(b.seq) ? b.seq : null;
  if (as !== null && bs !== null && as !== bs) return as - bs;
  if (as !== null && bs === null) return -1;
  if (as === null && bs !== null) return 1;
  const at = Date.parse(String(a.created_at || ""));
  const bt = Date.parse(String(b.created_at || ""));
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function sortTranscriptTurns<T extends OrderedTurn>(rows: readonly T[]): T[] {
  return [...rows].sort(compareTranscriptTurns);
}

/** True when the error says transcripts.seq is not there yet (before Voice applies it). */
export function isMissingSeqColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || /\bseq\b/i.test(String(error.message || ""));
}
