/**
 * DESK_CONTACT_NAME_LOCK, on only when exactly "on" (same rule as BRAIN_CALL_FIXES_D199).
 * Off: today's contact name behaviour. On: "This number is one person", the "Also heard
 * as" list with remove, and owner renames that lock the name. Server only.
 */
export function contactNameLockFromEnv(): boolean {
  return String(process.env.DESK_CONTACT_NAME_LOCK || "").trim() === "on";
}
