/** Named parent for a ticket or contact file. The visible label is the destination, never Back. */

function cleanId(raw?: string | null): string {
  const id = String(raw || "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return "";
  return id;
}

/** Saved contact name, or Contacts when the file has no name yet. */
export function contactBackLabel(name?: string | null): string {
  const trimmed = String(name || "").trim();
  return trimmed || "Contacts";
}

/** Ticket opened from a contact file. Back returns to that file. */
export function callOpenedFromContactHref(callId: string, contactId: string): string {
  const call = cleanId(callId);
  const contact = cleanId(contactId);
  return `/calls/${call}?from=contact&contact=${contact}`;
}

/** Ticket or chat header. Default with no from is Inbox. */
export function ticketDeskBack(input: {
  from?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  inboxHref: string;
}): { href: string; label: string } {
  const from = String(input.from || "").trim();
  if (from === "home") return { href: "/home", label: "Home" };
  const contactId = cleanId(input.contactId);
  if (from === "contact" && contactId) {
    return {
      href: `/contacts/${contactId}`,
      label: contactBackLabel(input.contactName),
    };
  }
  if (from === "contacts") return { href: "/contacts", label: "Contacts" };
  return { href: input.inboxHref || "/calls", label: "Inbox" };
}

/** Contact file header. A ticket parent keeps its deep link and the Inbox name. */
export function contactDeskBack(input: {
  from?: string | null;
  callHref?: string | null;
  inboxHref?: string | null;
  contactsHref: string;
}): { href: string; label: string } {
  const from = String(input.from || "").trim();
  if (from === "home") return { href: "/home", label: "Home" };
  if (from === "call" && input.callHref) return { href: input.callHref, label: "Inbox" };
  if (from === "inbox") return { href: input.inboxHref || "/calls", label: "Inbox" };
  return { href: input.contactsHref || "/contacts", label: "Contacts" };
}
