export function markSavedRow<T extends object>(row: T): T;
export function isSavedRow(row: object | null | undefined): boolean;
export function carrySavedRow<T extends object>(
  next: T,
  prev: object | null | undefined
): T;
