/** Grow a list by one modest slice. Callers keep earlier rows. */

export const LIST_SLICE = 25;

export const listWindowClass =
  "[&_li]:[content-visibility:auto] [&_li]:[contain-intrinsic-size:auto_4.5rem] [&_tr]:[content-visibility:auto] [&_tr]:[contain-intrinsic-size:auto_4.5rem]";

export function nextShown(shown: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const current = Math.max(0, Math.floor(shown) || 0);
  const cap = Math.max(0, Math.floor(total) || 0);
  if (current >= cap) return current;
  const base = Math.max(size, current);
  return Math.min(cap, base + size);
}

export function appendUniqueById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[]
): { rows: T[]; added: number } {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of current) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  let added = 0;
  for (const row of incoming) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
    added += 1;
  }
  return { rows, added };
}
