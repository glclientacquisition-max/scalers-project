import { sanitizeStoredCallerName } from "@/lib/callerNameQuality";
import { contactListSubline } from "@/lib/contactsLoad";

function isPhoneLike(value: string): boolean {
  return /^\+?[\d\s()-]+$/.test(value.trim());
}

/** Ticket identity title. Real name, or Unsaved / Name this caller. Never a phone. */
export function contactStripTitle(
  name: string | null | undefined,
  canName: boolean
): string {
  const cleaned = sanitizeStoredCallerName(name);
  if (cleaned && !isPhoneLike(cleaned)) return cleaned;
  return canName ? "Name this caller" : "Unsaved";
}

export function contactStripFact(row: {
  name?: string | null;
  phone?: string | null;
  lastContactAt?: string | null;
}): string {
  return contactListSubline(row);
}
