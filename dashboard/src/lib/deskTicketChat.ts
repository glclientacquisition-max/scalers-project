function deskPathname(pathname: string | null | undefined): string {
  if (!pathname) return "";
  return pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

/** Phone ticket chat: hide DESK_LINKS tabs. Rail on md+ stays. */
export function isDeskTicketChatPath(pathname: string | null | undefined): boolean {
  return /^\/calls\/[^/]+$/.test(deskPathname(pathname));
}

function settingsSearchTab(search: string | null | undefined): string {
  const raw = String(search || "").replace(/^\?/, "");
  if (!raw) return "";
  return new URLSearchParams(raw).get("tab") || "";
}

function isSettingsNestedTab(tab: string): boolean {
  return (
    tab === "updates" ||
    tab === "today" ||
    tab === "catalog" ||
    tab === "train" ||
    tab === "import" ||
    tab === "test" ||
    tab === "alerts" ||
    tab === "appearance"
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
