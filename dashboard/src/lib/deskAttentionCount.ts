/** Compact Needs you count for desk index chrome. Not a second pile. */
export function formatAttentionCount(count: number): string | null {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return null;
  return n > 9 ? "9+" : String(n);
}

export function formatAttentionCountAriaLabel(count: number): string | null {
  const display = formatAttentionCount(count);
  if (!display) return null;
  return `${display} need you`;
}
