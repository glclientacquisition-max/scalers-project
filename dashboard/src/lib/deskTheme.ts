/**
 * Desk appearance is a per-browser preference.
 * Never a tenant column. Never Brain / compile state.
 */

export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme";

/** Safari chrome. Must match `--canvas` in globals.css. Never brand. */
export const DESK_THEME_COLOR_LIGHT = "#f4f7fb";
export const DESK_THEME_COLOR_DARK = "#0b1220";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE_PAIR = new RegExp(`(?:^|;\\s*)${DESK_THEME_STORAGE_KEY}=(light|dark)(?:;|$)`);

export type DeskTheme = "system" | "light" | "dark";

const listeners = new Set<() => void>();

export function parseDeskTheme(raw: string | null | undefined): DeskTheme {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function readDeskThemeCookie(source: string | null | undefined): DeskTheme {
  const match = source?.match(COOKIE_PAIR);
  return match ? parseDeskTheme(match[1]) : "system";
}

function writeDeskThemeCookie(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  if (choice === "system") {
    document.cookie = `${DESK_THEME_STORAGE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
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
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(DESK_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // private mode: cookie still covers this device
  }
  try {
    return readDeskThemeCookie(document.cookie);
  } catch {
    return "system";
  }
}

export function writeDeskTheme(choice: DeskTheme): void {
  if (typeof window === "undefined") return;
  try {
    if (choice === "system") {
      window.localStorage.removeItem(DESK_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DESK_THEME_STORAGE_KEY, choice);
    }
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
export function deskColorSchemeValue(choice: Exclude<DeskTheme, "system">): string {
  return choice === "dark" ? "dark only" : "light only";
}

function syncColorSchemeMeta(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  const head = document.head;
  if (!head) return;
  let meta = head.querySelector('meta[name="color-scheme"]');
  if (choice === "system") {
    meta?.remove();
    return;
  }
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

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readDeskTheme() === "system") syncThemeColorMeta();
  });
}

export function applyDeskTheme(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
    // Empty inline so prefers-color-scheme wins for native option lists.
    root.style.colorScheme = "";
    if (document.body) document.body.style.colorScheme = "";
  } else {
    root.dataset.theme = choice;
    const scheme = deskColorSchemeValue(choice);
    root.style.colorScheme = scheme;
    if (document.body) document.body.style.colorScheme = scheme;
  }
  syncColorSchemeMeta(choice);
  syncThemeColorMeta();
}
