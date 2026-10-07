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
import { DeskPageSkeleton } from "@/components/DeskPageSkeleton";
import { nextDeskPendingHref } from "@/lib/deskPending";
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
  const [needsCount, setNeedsCount] = useState(0);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const dest = inAppPath((event.target as Element | null)?.closest?.("a") ?? null);
      if (!dest) return;
      const path = dest.split("?")[0] || dest;
      if (path === window.location.pathname) return;
      const deskPath =
        path.startsWith("/home") ||
        path.startsWith("/calls") ||
        path.startsWith("/contacts") ||
        path.startsWith("/wallet") ||
        path.startsWith("/settings");
      if (!deskPath) return;
      setPendingHref((current) =>
        nextDeskPendingHref(current, {
          type: "start",
          href: path,
          pathname: window.location.pathname,
        })
      );
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

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

/** Push a fresh Needs you count into the tab bar and rail badge. */
export function useDeskSetNeedsCount(): Dispatch<SetStateAction<number>> {
  return useContext(SetNeedsCountContext);
}

export function useDeskPendingHref(): string | null {
  return useContext(PendingHrefContext);
}

export function useDeskPendingSetter(): Dispatch<SetStateAction<string | null>> {
  return useContext(SetPendingHrefContext);
}

/**
 * Paints the list skeleton on the click and holds it until `DeskPageCommit`.
 * Children stay mounted. The `hidden` attribute is not used: it both revealed
 * a half-finished server stream and sat on the suspense boundary.
 */
export function DeskPendingSlot({ children }: { children: ReactNode }) {
  const pending = useDeskPendingHref();
  if (!pending) {
    return <div className="contents">{children}</div>;
  }
  return (
    <div className="relative min-w-0" aria-busy="true">
      <div
        className="pointer-events-none invisible absolute inset-x-0 top-0 w-full"
        aria-hidden="true"
        inert
      >
        {children}
      </div>
      <DeskPageSkeleton />
    </div>
  );
}

function deskSlotConcealed(node: HTMLElement): boolean {
  const host = node.parentElement;
  if (!host) return true;
  return host.closest("[hidden]") != null;
}

/**
 * Renders only after the page body resolves, so the tap skeleton can stay
 * through the URL change. A concealed Activity copy must not clear it.
 */
export function DeskPageCommit({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const routeRef = useRef<string | null>(null);
  const pathname = usePathname();
  const setPending = useDeskPendingSetter();

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const concealed = deskSlotConcealed(node);
    if (!concealed && routeRef.current == null) routeRef.current = pathname;
    const route = routeRef.current;
    if (!route) return;
    setPending((current) =>
      nextDeskPendingHref(current, { type: "committed", pathname: route, concealed })
    );
  }, [pathname, setPending]);

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
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
