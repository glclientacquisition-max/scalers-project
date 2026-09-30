"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  applyDeskScroll,
  deskListScrollKey,
  deskScrollApplying,
  deskScrollSavesHeld,
  holdDeskScrollSaves,
  snapshotDeskScroll,
  writeDeskScroll,
} from "@/lib/deskScrollMemory";

const NeedsCountContext = createContext(0);
const SetNeedsCountContext = createContext<Dispatch<SetStateAction<number>>>(() => {});
const PendingHrefContext = createContext<string | null>(null);
const SetPendingHrefContext = createContext<Dispatch<SetStateAction<string | null>>>(() => {});

/** Owner-desk nav state. Count and pending route stay in separate contexts so a badge update does not rebuild the shell. */
export function DeskNavHost({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [needsCount, setNeedsCount] = useState(0);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <NeedsCountContext.Provider value={needsCount}>
      <SetNeedsCountContext.Provider value={setNeedsCount}>
        <PendingHrefContext.Provider value={pendingHref}>
          <SetPendingHrefContext.Provider value={setPendingHref}>
            {children}
          </SetPendingHrefContext.Provider>
        </PendingHrefContext.Provider>
      </SetNeedsCountContext.Provider>
    </NeedsCountContext.Provider>
  );
}

/** Streamed inbox count. Renders nothing, so the rail and tab bar stay mounted. */
export function DeskNeedsCountBridge({ count }: { count: number }) {
  const setCount = useContext(SetNeedsCountContext);
  useEffect(() => {
    setCount(count);
  }, [count, setCount]);
  return null;
}

export function useDeskNeedsCount(): number {
  return useContext(NeedsCountContext);
}

export function useDeskPendingHref(): string | null {
  return useContext(PendingHrefContext);
}

export function useDeskPendingSetter(): Dispatch<SetStateAction<string | null>> {
  return useContext(SetPendingHrefContext);
}

function deskMain(): HTMLElement | null {
  return document.querySelector("[data-desk-main]");
}

function inAppPath(anchor: Element | null): string | null {
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) return null;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function herePath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Remembers `[data-desk-main]` scroll per list URL.
 * Must sit under Suspense: `useSearchParams` suspends during static render.
 */
export function DeskScrollRestore() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = deskListScrollKey(pathname, search);
  const keyRef = useRef(key);

  useLayoutEffect(() => {
    keyRef.current = key;
    applyDeskScroll(deskMain(), key);
    holdDeskScrollSaves(false);
  }, [key]);

  useEffect(() => {
    const main = deskMain();
    if (!main) return;

    const onScroll = () => {
      if (deskScrollApplying() || deskScrollSavesHeld()) return;
      const current = keyRef.current;
      if (!current) return;
      writeDeskScroll(current, main.scrollTop);
    };

    const arm = (anchor: Element | null) => {
      const dest = inAppPath(anchor);
      if (!dest) return;
      snapshotDeskScroll(main, keyRef.current);
      if (dest === herePath()) {
        holdDeskScrollSaves(false);
        return;
      }
      holdDeskScrollSaves(true);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      arm((event.target as Element | null)?.closest?.("a") ?? null);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!deskScrollSavesHeld()) return;
      const dest = inAppPath((event.target as Element | null)?.closest?.("a") ?? null);
      if (!dest || dest === herePath()) holdDeskScrollSaves(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      arm((event.target as Element | null)?.closest?.("a") ?? null);
    };

    main.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      main.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
