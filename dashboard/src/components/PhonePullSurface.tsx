"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { revalidateDeskPull } from "@/lib/deskPullAction";
import { shellPullErrorCopy, shellPullPlan } from "@/lib/endlessList";
import { DeskError } from "@/components/ui/DeskError";
import {
  PullRefreshMark,
  adminGestureScrollTop,
  deskGestureScrollTop,
  elementScrolls,
  pullRootVisible,
  usePhoneListPull,
  usePhoneTabRefresh,
  windowGestureScrollTop,
} from "@/components/PhonePullRefresh";

function visibleOwnedPullRoot(): boolean {
  for (const node of document.querySelectorAll("[data-pull-root]")) {
    if (node instanceof HTMLElement && pullRootVisible(node)) return true;
  }
  return false;
}

function usePullMarkSlot(show: boolean, portal: boolean): HTMLElement | "inline" | null {
  const [slot, setSlot] = useState<HTMLElement | "inline" | null>(null);

  useLayoutEffect(() => {
    if (!show) {
      setSlot(null);
      return;
    }
    if (!portal) {
      setSlot("inline");
      return;
    }
    const desk = document.querySelector("[data-desk-main]");
    if (!(desk instanceof HTMLElement) || elementScrolls(desk)) {
      setSlot("inline");
      return;
    }
    const pane = [...desk.querySelectorAll("[data-pull-scroll]")].find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && pullRootVisible(node) && elementScrolls(node)
    );
    if (!pane) {
      setSlot("inline");
      return;
    }
    const el = document.createElement("div");
    el.setAttribute("data-pull-slot", "");
    el.className = "sticky top-0 z-10 bg-surface";
    pane.insertBefore(el, pane.firstChild);
    setSlot(el);
    return () => {
      el.remove();
    };
  }, [show, portal]);

  return slot;
}

/**
 * Same phone pull as Inbox and Contacts, for routes that do not own a list root.
 * A dirty guarded field skips the reload. A failed reload leaves the screen in place.
 */
function PhonePullSurface({
  rootSelector,
  scroll,
  yieldToOwned = false,
  surface,
}: {
  rootSelector: "[data-desk-main]" | "[data-admin-main]";
  scroll: "desk" | "window" | "admin";
  yieldToOwned?: boolean;
  surface: "desk" | "admin";
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const search = useSearchParams().toString();
  const rootRef = useRef<HTMLElement | null>(null);
  const dirtyRef = useRef(false);
  const flight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState(0);

  useLayoutEffect(() => {
    const node = document.querySelector(rootSelector);
    rootRef.current = node instanceof HTMLElement ? node : null;
  }, [rootSelector, pathname, search]);

  useEffect(() => {
    dirtyRef.current = false;
    setError(null);
    const root = document.querySelector(rootSelector);
    if (!root) return;
    const onEdit = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-pull-dirty-guard]")) return;
      if (!target.closest("input, textarea, select")) return;
      dirtyRef.current = true;
    };
    root.addEventListener("input", onEdit);
    root.addEventListener("change", onEdit);
    return () => {
      root.removeEventListener("input", onEdit);
      root.removeEventListener("change", onEdit);
    };
  }, [rootSelector, pathname, search]);

  function refresh() {
    if (flight.current) return;
    if (shellPullPlan({ dirty: dirtyRef.current, failed: false }) !== "refresh") return;
    flight.current = true;
    setRefreshing(true);
    setError(null);
    void (async () => {
      try {
        if (!pathname.startsWith("/dev/")) {
          const res = await revalidateDeskPull(pathname);
          if (shellPullPlan({ dirty: false, failed: !res.ok }) === "keep") {
            setError(shellPullErrorCopy(pathname));
            return;
          }
        }
        router.refresh();
        setCommits((count) => count + 1);
      } catch {
        if (shellPullPlan({ dirty: false, failed: true }) === "keep") {
          setError(shellPullErrorCopy(pathname));
        }
      } finally {
        flight.current = false;
        setRefreshing(false);
      }
    })();
  }

  const pulling = usePhoneListPull(rootRef, refresh, {
    allow: yieldToOwned ? () => !visibleOwnedPullRoot() : undefined,
    getScrollTop:
      scroll === "window"
        ? () => windowGestureScrollTop()
        : scroll === "admin"
          ? () => adminGestureScrollTop()
          : (target) => deskGestureScrollTop(target),
  });
  usePhoneTabRefresh(refresh, () => {
    if (!pullRootVisible(rootRef.current)) return false;
    if (yieldToOwned && visibleOwnedPullRoot()) return false;
    return true;
  });

  const showMark = pulling || refreshing;
  const slot = usePullMarkSlot(showMark, scroll === "desk");
  const mark = <PullRefreshMark show={showMark && slot !== null} />;

  return (
    <div data-pull-host="" data-pull-surface={surface} data-pull-commits={String(commits)} className="contents">
      {error ? (
        <div className="mb-4" data-pull-error="">
          <DeskError>{error}</DeskError>
        </div>
      ) : null}
      {/* Narrow by value, not DOM class: this renders during SSR, where HTMLElement is undefined. */}
      {slot !== null && slot !== "inline" ? createPortal(mark, slot) : mark}
    </div>
  );
}

export function DeskPhonePull() {
  return <PhonePullSurface rootSelector="[data-desk-main]" scroll="desk" yieldToOwned surface="desk" />;
}

export function AdminPhonePull({ scroll = "window" }: { scroll?: "window" | "admin" }) {
  return <PhonePullSurface rootSelector="[data-admin-main]" scroll={scroll} surface="admin" />;
}
