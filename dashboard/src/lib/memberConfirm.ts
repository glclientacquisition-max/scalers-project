/** Typed confirmation for ownership transfer: the new owner's email, case/space-insensitive. */
export function transferConfirmMatches(typed: string, expected: string): boolean {
  const norm = (v: string) => String(v || "").trim().toLowerCase();
  return norm(expected).length > 0 && norm(typed) === norm(expected);
}
