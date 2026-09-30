"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import { pickPullScrollTop, pullRefreshCommit } from "@/lib/endlessList";

function phoneWidth(): boolean {
  return window.matchMedia("(max-width: 767px)").matches;
}

function fieldTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select"));
}

/** Visible list root. A hidden Activity copy has no client rects and must not refresh. */
export function pullRootVisible(node: HTMLElement | null): boolean {
  if (!node) return false;
  return node.getClientRects().length > 0;
}

function defaultScrollTop(): number {
  const main = document.querySelector("[data-desk-main]");
  if (!(main instanceof HTMLElement)) return 1;
  return main.scrollTop;
}

export function elementScrolls(node: HTMLElement): boolean {
  const overflowY = getComputedStyle(node).overflowY;
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

function closestPullPane(target: EventTarget | null, desk: HTMLElement): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  let node: Node | null = target;
  while (node && node !== desk) {
    if (node instanceof HTMLElement && node.hasAttribute("data-pull-scroll") && elementScrolls(node)) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function solePullPane(desk: HTMLElement): HTMLElement | null {
  const panes = [...desk.querySelectorAll("[data-pull-scroll]")].filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && pullRootVisible(node) && elementScrolls(node)
  );
  return panes.length === 1 ? panes[0] : null;
}

/** Desk well, or the open ticket pane when the well itself does not scroll. */
export function deskGestureScrollTop(target: EventTarget | null): number {
  const desk = document.querySelector("[data-desk-main]");
  if (!(desk instanceof HTMLElement)) return 1;
  if (elementScrolls(desk)) {
    return pickPullScrollTop({
      deskScrolls: true,
      deskTop: desk.scrollTop,
      paneScrolls: false,
      paneTop: 0,
    });
  }
  const pane = closestPullPane(target, desk) ?? solePullPane(desk);
  if (!pane) return 1;
  return pickPullScrollTop({
    deskScrolls: false,
    deskTop: desk.scrollTop,
    paneScrolls: true,
    paneTop: pane.scrollTop,
  });
}

export function windowGestureScrollTop(): number {
  const scrolling = document.scrollingElement;
  return scrolling instanceof HTMLElement ? scrolling.scrollTop : 1;
}

type PhonePullOptions = {
  /** Return false when another visible pull root owns the gesture. */
  allow?: () => boolean;
  /** Scroll position that gates the gesture. Default is the desk well. */
  getScrollTop?: (target: EventTarget | null) => number;
};

/**
 * Touch pull on a phone list. No listener work on md+.
 * The callback ref stays current so the listener is bound once.
 */
export function usePhoneListPull(
  rootRef: RefObject<HTMLElement | null>,
  onRefresh: () => void,
  options?: PhonePullOptions
): boolean {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const allowRef = useRef(options?.allow);
  allowRef.current = options?.allow;
  const getScrollTopRef = useRef(options?.getScrollTop);
  getScrollTopRef.current = options?.getScrollTop;
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;

    function readTop(target: EventTarget | null): number {
      if (getScrollTopRef.current) return getScrollTopRef.current(target);
      return defaultScrollTop();
    }

    function disarm() {
      tracking = false;
      if (armed) setPulling(false);
      armed = false;
    }

    function onStart(event: TouchEvent) {
      if (!mq.matches || event.touches.length !== 1) return;
      if (!pullRootVisible(rootRef.current)) return;
      if (fieldTarget(event.target)) return;
      if (allowRef.current && !allowRef.current()) return;
      if (readTop(event.target) > 0) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
      armed = false;
    }

    function onMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 1) return;
      const scrollTop = readTop(event.target);
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (scrollTop > 0 || (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy))) {
        disarm();
        return;
      }
      const next = pullRefreshCommit({
        phone: phoneWidth(),
        scrollTop,
        dx,
        dy,
      });
      if (next !== armed) {
        armed = next;
        setPulling(next);
      }
    }

    function onEnd() {
      if (!tracking) return;
      const commit = armed && pullRootVisible(rootRef.current);
      disarm();
      if (commit) onRefreshRef.current();
    }

    function bind() {
      if (!mq.matches) return;
      document.addEventListener("touchstart", onStart, { passive: true });
      document.addEventListener("touchmove", onMove, { passive: true });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    }

    function unbind() {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    }

    function onChange() {
      unbind();
      disarm();
      bind();
    }

    bind();
    mq.addEventListener("change", onChange);
    return () => {
      unbind();
      mq.removeEventListener("change", onChange);
    };
  }, [rootRef]);

  return pulling;
}

/** Quiet pending mark. Phone only. Same spinner as the endless sentinel. */
export function PullRefreshMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      data-pull-refresh=""
      className="flex min-h-11 shrink-0 items-center justify-center md:hidden"
      aria-live="polite"
    >
      <span aria-hidden="true" className={pendingSpinnerInkClass} />
      <span className="sr-only">Loading</span>
    </div>
  );
}
