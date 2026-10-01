/**
 * Desk appearance is a per-browser preference.
 * Never a tenant column. Never Brain / compile state.
 */

export const DESK_THEME_STORAGE_KEY = "scalers-desk-theme";

export type DeskTheme = "system" | "light" | "dark";

export function parseDeskTheme(raw: string | null | undefined): DeskTheme {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function readDeskTheme(): DeskTheme {
  if (typeof window === "undefined") return "system";
  try {
    return parseDeskTheme(window.localStorage.getItem(DESK_THEME_STORAGE_KEY));
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
    // private mode: applyDeskTheme still covers this session
  }
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
}
