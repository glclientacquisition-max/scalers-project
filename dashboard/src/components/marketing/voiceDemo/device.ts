const STORAGE_KEY = "scalers.demo.device";
const COOKIE = "scalers_demo_device";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable device id for the token request. Called on Start, not on first paint. */
export function demoDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // Private mode can throw. Fall through to a cookie or a fresh id.
  }
  const fromCookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const id = fromCookie || randomId();
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Ignore quota and private-mode failures.
  }
  document.cookie = `${COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return id;
}
