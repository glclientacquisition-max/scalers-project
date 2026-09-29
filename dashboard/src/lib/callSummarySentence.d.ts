export function pickCallOwnerReason(
  meta: Record<string, unknown> | null | undefined
): string | null;

export function pickCallOwnerWant(
  meta: Record<string, unknown> | null | undefined
): string | null;

export function pickCallOwnerCard(
  meta: Record<string, unknown> | null | undefined
): {
  want: string | null;
  done: string | null;
  mood: string | null;
  next: string | null;
} | null;

export function buildSummarySentence(opts: {
  name: string | null;
  reason: string | null;
  callerNumber: string;
  urgent?: boolean;
}): string;

export function displayContactLastReason(opts: {
  name: string | null;
  phone: string | null;
  lastReason: string | null;
  latestCallReason: string | null;
}): string | null;

export function usefulOwnerFact(raw: string | null | undefined): string;

export function usefulMoodLabel(raw: string | null | undefined): string;
