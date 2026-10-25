/** Installable Desk helpers (no React). Runbook: docs/reference/platform/DESK_PWA_PUSH.md */

export type PwaEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_ADMIN_HOST?: string;
  NEXT_PUBLIC_APP_HOST?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

function host(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

/**
 * Register /sw.js only in production, never on the admin host or an /admin page, and only on
 * the app host when the app host is split from the marketing site.
 */
export function shouldRegisterServiceWorker(hostname: string, pathname: string, env: PwaEnv): boolean {
  if (env.NODE_ENV !== "production") return false;
  const h = host(hostname);
  const admin = host(env.NEXT_PUBLIC_ADMIN_HOST);
  if (admin && h === admin) return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return false;
  const app = host(env.NEXT_PUBLIC_APP_HOST);
  const site = host(env.NEXT_PUBLIC_SITE_URL);
  if (app && site && app !== site && h !== app) return false;
  return true;
}

export type InstallPlatform = "android" | "ios" | "installed" | "other";

export function installPlatform(ua: string, standalone: boolean): InstallPlatform {
  if (standalone) return "installed";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
export const INSTALL_SNOOZE_KEY = "scalers-install-snooze";
export const INSTALL_VISITS_KEY = "scalers-visits";

/** Show only after value: a call is in the Inbox, or this is the second visit or later. Never on admin. */
export function shouldShowInstallCard(opts: {
  pathname: string;
  platform: InstallPlatform;
  hasCall: boolean;
  visits: number;
  snoozedUntil: number;
  now: number;
  canPrompt: boolean;
}): boolean {
  if (opts.pathname.startsWith("/admin")) return false;
  if (opts.platform === "installed" || opts.platform === "other") return false;
  if (opts.platform === "android" && !opts.canPrompt) return false;
  if (opts.snoozedUntil > opts.now) return false;
  return opts.hasCall || opts.visits >= 2;
}

/** Push needs a home-screen install on iOS. */
export type PushSupport = "ok" | "unsupported" | "ios-needs-install";

export function pushSupport(opts: {
  platform: InstallPlatform;
  ua: string;
  hasPushManager: boolean;
  hasNotification: boolean;
}): PushSupport {
  const ios = /iPhone|iPad|iPod/i.test(opts.ua);
  if (ios && opts.platform !== "installed") return "ios-needs-install";
  if (!opts.hasPushManager || !opts.hasNotification) return "unsupported";
  return "ok";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function deviceLabelFrom(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Macintosh/i.test(ua)) return "Mac";
  return "This device";
}
