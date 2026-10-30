/**
 * Reduce effects is a per-browser preference.
 * Never a tenant column. Full is the default. Reduced drops blur and the shell glow.
 * Stored in localStorage. A head script applies it before first paint.
 * OS prefers-reduced-transparency and prefers-reduced-motion do the same in CSS.
 */

export const DESK_EFFECTS_STORAGE_KEY = "scalers-desk-effects";

export type DeskEffects = "full" | "reduced";

const listeners = new Set<() => void>();

export function parseDeskEffects(raw: string | null | undefined): DeskEffects {
  return raw === "reduced" ? "reduced" : "full";
}

function emitDeskEffects(): void {
  for (const listener of listeners) listener();
}

export function subscribeDeskEffects(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(onStoreChange);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === DESK_EFFECTS_STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function readDeskEffects(): DeskEffects {
  if (typeof window === "undefined") return "full";
  try {
    return parseDeskEffects(window.localStorage.getItem(DESK_EFFECTS_STORAGE_KEY));
  } catch {
    return "full";
  }
}

export function writeDeskEffects(mode: DeskEffects): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "reduced") window.localStorage.setItem(DESK_EFFECTS_STORAGE_KEY, "reduced");
    else window.localStorage.removeItem(DESK_EFFECTS_STORAGE_KEY);
  } catch {
    // private mode: applyDeskEffects still covers this session
  }
  emitDeskEffects();
}

export function applyDeskEffects(mode: DeskEffects): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "reduced") root.dataset.effects = "reduced";
  else delete root.dataset.effects;
}

/** Runs in <head> before first paint. Full unless "reduced" is stored. */
export const DESK_EFFECTS_INIT_SCRIPT = `try{var k=${JSON.stringify(DESK_EFFECTS_STORAGE_KEY)},v=null;try{v=localStorage.getItem(k)}catch(e){}var r=document.documentElement;if(v==="reduced")r.dataset.effects="reduced";else delete r.dataset.effects}catch(e){}`;
