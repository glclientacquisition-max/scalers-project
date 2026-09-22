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

export function applyDeskTheme(choice: DeskTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}
