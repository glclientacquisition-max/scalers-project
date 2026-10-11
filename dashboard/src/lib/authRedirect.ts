/** Where auth emails send people back to, and safe "next" handling. Pure, no server imports. */

/** Only same-site relative paths. Anything else falls back. */
export function safeNextPath(raw: unknown, fallback = "/home"): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s)) return fallback;
  return s;
}

/** Origin of the current request (Vercel sets x-forwarded-*). */
export function originFromHeaders(get: (name: string) => string | null | undefined, fallbackHost: string): string {
  const host = String(get("x-forwarded-host") || get("host") || fallbackHost || "").split(",")[0].trim();
  const protoRaw = String(get("x-forwarded-proto") || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = protoRaw === "http" || protoRaw === "https" ? protoRaw : local ? "http" : "https";
  return `${proto}://${host}`;
}

export function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Email confirmation for an invite returns through /auth/confirm, then to the invite. */
export function inviteConfirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/auth/confirm?next=${encodeURIComponent(invitePath(token))}`;
}

/** Invite token from a safe next path like /invite/<token>, else null. */
export function inviteTokenFromNext(next: string): string | null {
  const m = /^\/invite\/([^/?#]+)/.exec(next);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Supabase may drop redirect_to and land on the site root with ?code= or ?token_hash=. */
export function rootAuthForward(pathname: string, search: URLSearchParams): string | null {
  if (pathname !== "/") return null;
  if (!search.get("code") && !search.get("token_hash")) return null;
  const q = new URLSearchParams(search);
  if (!q.get("next")) q.set("next", "/home");
  return `/auth/confirm?${q.toString()}`;
}

export function welcomeHomePath(businessName: string): string {
  return `/home?welcome=${encodeURIComponent(businessName.slice(0, 80))}`;
}
