/**
 * Desk appearance is a per-browser preference.
 * Never a tenant column. Never Brain / compile state.
 * Light is the default everywhere. Dark only when the owner picks it; the OS
 * setting is not followed. Stored in localStorage and a cookie so the server
 * renders the picked theme on the first byte.
 */

export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme";

/** Safari chrome. Must match `--canvas` in globals.css. Never brand. */
export const DESK_THEME_COLOR_LIGHT = "#f4f7fb";
export const DESK_THEME_COLOR_DARK = "#0b1220";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE_PAIR = new RegExp(`(?:^|;\\s*)${DESK_THEME_STORAGE_KEY}=(light|dark)(?:;|$)`);

export type DeskTheme = "light" | "dark";

const listeners = new Set<() => void>();

export function parseDeskTheme(raw: string | null | undefined): DeskTheme {
  return raw === "dark" ? "dark" : "light";
}

export function readDeskThemeCookie(source: string | null | undefined): DeskTheme {
  const match = source?.match(COOKIE_PAIR);
  return match ? parseDeskTheme(match[1]) : "light";
}

function writeDeskThemeCookie(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  document.cookie = `${DESK_THEME_STORAGE_KEY}=${choice}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function emitDeskTheme(): void {
  for (const listener of listeners) listener();
}

export function subscribeDeskTheme(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(onStoreChange);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === DESK_THEME_STORAGE_KEY || event.key === null) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function readDeskTheme(): DeskTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(DESK_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // private mode: cookie still covers this device
  }
  try {
    return readDeskThemeCookie(document.cookie);
  } catch {
    return "light";
  }
}

export function writeDeskTheme(choice: DeskTheme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DESK_THEME_STORAGE_KEY, choice);
  } catch {
    // private mode: cookie + applyDeskTheme still cover this session
  }
  try {
    writeDeskThemeCookie(choice);
  } catch {
    // ignore cookie write failures
  }
  emitDeskTheme();
}

/** Inline CSSOM value: `only` blocks UA scheme overrides for explicit picks. */
export function deskColorSchemeValue(choice: DeskTheme): string {
  return choice === "dark" ? "dark only" : "light only";
}

function syncColorSchemeMeta(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!head) return;
  let meta = head.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "color-scheme");
    head.appendChild(meta);
  }
  // Meta content is light|dark (no `only`; that keyword is CSS-only).
  meta.setAttribute("content", choice);
}

function syncThemeColorMeta(): void {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!head) return;
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
  if (!canvas) return;
  const metas = Array.from(head.querySelectorAll('meta[name="theme-color"]'));
  let meta = metas.find((node) => !node.getAttribute("media"));
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    head.insertBefore(meta, head.firstChild);
  }
  meta.setAttribute("content", canvas);
}

export function applyDeskTheme(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = choice;
  const scheme = deskColorSchemeValue(choice);
  root.style.colorScheme = scheme;
  if (document.body) document.body.style.colorScheme = scheme;
  syncColorSchemeMeta(choice);
  syncThemeColorMeta();
}

/**
 * Runs in <head> before first paint. The server already set data-theme from the
 * cookie; this covers a localStorage pick whose cookie was cleared, and syncs the
 * theme-color meta to the painted canvas. Light unless "dark" is stored.
 */
export const DESK_THEME_INIT_SCRIPT = `try{var k=${JSON.stringify(DESK_THEME_STORAGE_KEY)},t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="dark"&&t!=="light"){var c=document.cookie.match(/(?:^|; )${DESK_THEME_STORAGE_KEY}=(light|dark)(?:;|$)/);t=c?c[1]:"light"}var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t==="dark"?"dark only":"light only";var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="dark"?${JSON.stringify(DESK_THEME_COLOR_DARK)}:${JSON.stringify(DESK_THEME_COLOR_LIGHT)};document.cookie=k+"="+t+"; Path=/; Max-Age=31536000; SameSite=Lax"}catch(e){}`;
