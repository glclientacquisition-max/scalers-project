/**
 * One answer to "who is waiting for a number". Pure, no `@/` imports, so node tests can load it.
 * Today, Businesses, and Numbers all read this, so their counts always agree.
 * Archived businesses never wait: no Needs you row, no Assign.
 */

export type WaitingInput = {
  sautikit_virtual_number: string | null;
  is_active: boolean | null;
  archived_at?: string | null;
};

export function isArchivedBusiness(
  row: Pick<WaitingInput, "is_active" | "archived_at">,
): boolean {
  return row.is_active === false || Boolean(row.archived_at);
}

export function isWaitingBusiness(row: WaitingInput): boolean {
  if (isArchivedBusiness(row)) return false;
  return String(row.sautikit_virtual_number || "")
    .trim()
    .toLowerCase()
    .startsWith("pending:");
}

export function waitingBusinesses<T extends WaitingInput>(
  rows: readonly T[],
): T[] {
  return rows.filter(isWaitingBusiness);
}
