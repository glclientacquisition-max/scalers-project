/** Signup email confirmation: where the link returns to, and safe "next" handling. Pure. */

/** Only same-site relative paths; anything else falls back. */
export function safeNext(raw: unknown, fallback = "/onboarding"): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s)) return fallback;
  return s;
}

/** Request origin behind Vercel (x-forwarded-*), http only for localhost. */
export function requestOrigin(get: (name: string) => string | null | undefined): string {
  const host = String(get("x-forwarded-host") || get("host") || "").split(",")[0].trim();
  const protoRaw = String(get("x-forwarded-proto") || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = protoRaw === "http" || protoRaw === "https" ? protoRaw : local ? "http" : "https";
  return `${proto}://${host}`;
}

/** Link target for signup confirmation and resend: /auth/callback, then setup. */
export function signupConfirmUrl(origin: string, next = "/onboarding"): string {
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/** Where to send someone whose link could not sign them in. */
export function callbackFailurePath(errorCode: string | null | undefined): string {
  const code = String(errorCode || "");
  if (/expired/i.test(code)) return "/login?link=expired";
  return "/login?link=confirmed";
}
