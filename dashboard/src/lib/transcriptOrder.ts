/**
 * Transcript turn order. Rows written in the same millisecond (greeting and the
 * caller's first words) sorted by created_at alone showed the greeting after
 * the caller (owner review, 18 Oct 2026). Voice is adding transcripts.seq
 * (0-based turn index, nullable): sort by seq asc nulls last, then created_at,
 * then id. Relative imports only, so node tests load it directly.
 */
export type OrderedTurn = { id?: string | null; created_at?: string | null; seq?: number | null };

function seqOf(row: OrderedTurn): number | null {
  return typeof row.seq === "number" && Number.isFinite(row.seq) ? row.seq : null;
}

function timeOf(row: OrderedTurn): number | null {
  const t = Date.parse(String(row.created_at || ""));
  return Number.isFinite(t) ? t : null;
}

/**
 * A greeting written before Voice stored seq has no seq and an earlier clock.
 * Same-millisecond rows still keep seq first (nulls last within 2s).
 */
function unsequencedIsOpening(unsequenced: OrderedTurn, sequenced: OrderedTurn): boolean {
  const open = timeOf(unsequenced);
  const sequencedAt = timeOf(sequenced);
  if (open === null || sequencedAt === null) return false;
  return open < sequencedAt - 2000;
}

export function compareTranscriptTurns(a: OrderedTurn, b: OrderedTurn): number {
  const as = seqOf(a);
  const bs = seqOf(b);
  if (as !== null && bs !== null && as !== bs) return as - bs;
  if (as !== null && bs === null) return unsequencedIsOpening(b, a) ? 1 : -1;
  if (as === null && bs !== null) return unsequencedIsOpening(a, b) ? -1 : 1;
  const at = timeOf(a);
  const bt = timeOf(b);
  if (at !== null && bt !== null && at !== bt) return at - bt;
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
