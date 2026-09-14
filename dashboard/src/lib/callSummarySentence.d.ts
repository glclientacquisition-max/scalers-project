export function pickCallOwnerReason(
  meta: Record<string, unknown> | null | undefined
): string | null;

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
