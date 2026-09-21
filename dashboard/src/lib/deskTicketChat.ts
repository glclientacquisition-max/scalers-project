/** Phone ticket chat: hide DESK_LINKS tabs. Rail on md+ stays. */
export function isDeskTicketChatPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return /^\/calls\/[^/]+$/.test(path);
}

/** Owner-facing ticket copy: em/en dash becomes a plain hyphen. */
export function plainOwnerCopy(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\u2014\u2013]/g, "-");
}
