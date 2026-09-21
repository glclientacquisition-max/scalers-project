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

/**
 * Critic allowlist for strip lines. One fact only.
 * Reach, if stamped, is opened (`tel:` / `wa.me`). Never sent/delivered without channel evidence.
 */
export const CONTACT_STRIP_FACTS = [
  "Unsaved",
  "phone",
  "lastCall",
  "opened",
] as const;

export type ContactStripFact = (typeof CONTACT_STRIP_FACTS)[number];

/** Call / WhatsApp on the strip. DeskHint stays Call / WhatsApp. Ladder word is opened. */
export const CONTACT_STRIP_REACH = "opened" as const;

export const CONTACT_STRIP_CRITIC_BANS = [
  "Online",
  "last seen",
  "Last seen",
  "presence",
  "active now",
  "Active now",
  "delivered",
  "Delivered",
  "sent",
  "lead_status",
  "Needs you",
  "Meta",
] as const;

export { contactListSubline };
