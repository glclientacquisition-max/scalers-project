function deskPathname(pathname: string | null | undefined): string {
  if (!pathname) return "";
  return pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

const DEV_PHONE_TAB: Record<string, string> = {
  "/dev/home": "/home",
  "/dev/inbox": "/calls",
  "/dev/contacts": "/contacts",
  "/dev/usage": "/wallet",
  "/dev/settings": "/settings",
};

/** Map a local fixture path onto the desk tab it stands in for. */
export function deskPhoneTabPath(pathname: string | null | undefined): string {
  const path = deskPathname(pathname);
  return DEV_PHONE_TAB[path] || path;
}

/**
 * Phone tab href. Fixture pages retap their own path.
 * Production tabs stay on DESK_LINKS.
 */
export function deskPhoneTabHref(itemHref: string, pathname: string | null | undefined): string {
  const path = deskPathname(pathname);
  if (deskPhoneTabPath(path) === itemHref && path !== itemHref) return path;
  return itemHref;
}

/** Phone ticket chat: hide DESK_LINKS tabs. Rail on md+ stays. */
export function isDeskTicketChatPath(pathname: string | null | undefined): boolean {
  return /^\/calls\/[^/]+$/.test(deskPathname(pathname));
}

/**
 * A ticket Next kept in a hidden Activity must not take hits or host a pull
 * after the owner is back on a list. The visible ticket on a live chat stays active.
 */
export function markHiddenDeskTickets(shell: Element): void {
  const live = shell.hasAttribute("data-desk-ticket-chat");
  for (const node of shell.querySelectorAll("[data-ticket-chat]")) {
    if (!(node instanceof HTMLElement)) continue;
    const shown = live && node.getClientRects().length > 0;
    if (shown) {
      node.removeAttribute("inert");
      if (node.getAttribute("aria-hidden") === "true") node.removeAttribute("aria-hidden");
      continue;
    }
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    node.removeAttribute("data-pull-host");
  }
}

function settingsSearchTab(search: string | null | undefined): string {
  const raw = String(search || "").replace(/^\?/, "");
  if (!raw) return "";
  return new URLSearchParams(raw).get("tab") || "";
}

function isSettingsNestedTab(tab: string): boolean {
  return (
    tab === "catalog" ||
    tab === "train" ||
    tab === "import" ||
    tab === "test" ||
    tab === "alerts"
  );
}

/**
 * Phone / tablet below md: hide DESK_LINKS tabs so DeskBack and the record own the thumb zone.
 * List roots keep tabs. The md+ rail stays. Optional `search` covers Profile `?tab=` panels.
 */
export function isDeskNestedPath(
  pathname: string | null | undefined,
  search?: string | null
): boolean {
  const path = deskPathname(pathname);
  if (!path) return false;
  if (isDeskTicketChatPath(path)) return true;
  if (path === "/contacts/import") return true;
  if (path === "/dev/contacts/file" || path === "/dev/ticket") return true;
  if (/^\/contacts\/[^/]+$/.test(path)) return true;
  if (path === "/settings") {
    return isSettingsNestedTab(settingsSearchTab(search));
  }
  return false;
}

/** Owner-facing ticket copy: em/en dash becomes a plain hyphen. */
export function plainOwnerCopy(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\u2014\u2013]/g, "-");
}

const UNSET_ASSIST = /^(unknown|n\/a|none\.?)$/i;

/** Assist outcome. Unknown is unset and stays off the record. */
export function ownerAssistLabel(raw: string | null | undefined): string | null {
  const text = plainOwnerCopy(raw).trim();
  if (!text || UNSET_ASSIST.test(text)) return null;
  if (/^needs human$/i.test(text)) return "Requested owner callback";
  return text;
}

/** Pipeline dumps become owner status. Does not invent a call fact. */
export function ownerDeskLine(raw: string | null | undefined): string | null {
  const text = plainOwnerCopy(raw).trim();
  if (!text) return null;
  if (/notify failed/i.test(text)) return "Notification retry pending";
  if (/caller needed a human/i.test(text)) return "Requested owner callback";
  if (/^needs human\.?$/i.test(text)) return "Requested owner callback";
  return text;
}
