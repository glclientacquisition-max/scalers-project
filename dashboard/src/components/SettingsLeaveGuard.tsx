"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { settingsLeaveHref, settingsLeaveTarget } from "@/lib/settingsLeave";

type SetSource = (id: string, dirty: boolean) => void;

/** History entry we add while edits are unsaved, so Back lands here first. */
const GUARD_KEY = "__settingsLeaveGuard";
/** pendingHref value for the Android back gesture / browser Back. */
const BACK = "__back__";

const SettingsLeaveContext = createContext<SetSource>(() => {});

export function useSettingsLeaveSource(id: string, dirty: boolean) {
  const setSource = useContext(SettingsLeaveContext);
  useLayoutEffect(() => {
    setSource(id, dirty);
    return () => setSource(id, false);
  }, [id, dirty, setSource]);
}

function anyDirty(sources: Map<string, boolean>) {
  for (const value of sources.values()) {
    if (value) return true;
  }
  return false;
}

/**
 * Dirty settings stay put until the owner discards them.
 * A downward drag, Escape, or Keep editing leaves the edits in place.
 * Link clicks, page unloads, and Back (Android gesture or browser) all ask first.
 */
export function SettingsLeaveGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sources = useRef(new Map<string, boolean>());
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const armed = useRef(false);

  const setSource = useCallback((id: string, value: boolean) => {
    if (value) sources.current.set(id, true);
    else sources.current.delete(id);
    setDirty(anyDirty(sources.current));
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      if (anchor.getAttribute("target") === "_blank") return;
      if (anchor.hasAttribute("download")) return;
      const href = settingsLeaveTarget({
        dirty: anyDirty(sources.current),
        href: settingsLeaveHref(anchor.getAttribute("href"), window.location.href),
        modified: false,
      });
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Back gesture: same idea as onboarding's step history. While edits are unsaved we add
  // one same-URL entry; Back pops it and we ask before really leaving.
  const arm = useCallback(() => {
    if (armed.current) return;
    const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    window.history.pushState({ ...state, [GUARD_KEY]: true }, "", window.location.href);
    armed.current = true;
  }, []);

  useEffect(() => {
    if (dirty) arm();
  }, [dirty, arm]);

  useEffect(() => {
    function onPop(event: PopStateEvent) {
      const state = event.state as Record<string, unknown> | null;
      if (state && state[GUARD_KEY]) {
        // Forward onto our own entry again.
        armed.current = true;
        return;
      }
      if (!armed.current) return;
      armed.current = false;
      if (anyDirty(sources.current)) {
        setPendingHref(BACK);
        return;
      }
      // Saved since we armed: finish the Back the owner asked for.
      window.history.back();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function keepEditing() {
    if (pendingHref === BACK && anyDirty(sources.current)) arm();
    setPendingHref(null);
  }

  function discard() {
    const href = pendingHref;
    sources.current.clear();
    setDirty(false);
    setPendingHref(null);
    if (href === BACK) window.history.back();
    else if (href) router.push(href);
  }

  return (
    <SettingsLeaveContext.Provider value={setSource}>
      {children}
      <ConfirmSheet
        open={pendingHref != null}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onClose={keepEditing}
        onConfirm={discard}
      >
        These edits are not saved.
      </ConfirmSheet>
    </SettingsLeaveContext.Provider>
  );
}
