"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { settingsLeaveHref, settingsLeaveTarget } from "@/lib/settingsLeave";

type SetSource = (id: string, dirty: boolean) => void;

const SettingsLeaveContext = createContext<SetSource>(() => {});

export function useSettingsLeaveSource(id: string, dirty: boolean) {
  const setSource = useContext(SettingsLeaveContext);
  useEffect(() => {
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
 */
export function SettingsLeaveGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const sources = useRef(new Map<string, boolean>());
  const [dirty, setDirty] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

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

  function discard() {
    const href = pendingHref;
    sources.current.clear();
    setDirty(false);
    setPendingHref(null);
    if (href) router.push(href);
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
        onClose={() => setPendingHref(null)}
        onConfirm={discard}
      >
        These edits are not saved.
      </ConfirmSheet>
    </SettingsLeaveContext.Provider>
  );
}
