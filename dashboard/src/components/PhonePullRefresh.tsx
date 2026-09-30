"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import {
  PHONE_TAB_REFRESH_EVENT,
  pickPullScrollTop,
  pullRefreshCommit,
  threadPullAllowed,
  threadScrollAnchor,
  type ThreadAnchor,
} from "@/lib/endlessList";

function phoneWidth(): boolean {
  return window.matchMedia("(max-width: 767px)").matches;
}

function fieldTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select"));
}

/** Visible list root. A hidden or inert ticket must not refresh. */
export function pullRootVisible(node: HTMLElement | null): boolean {
  if (!node) return false;
  if (node.closest("[inert]")) return false;
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

/** Admin well. Same gate as the desk: pull only when this scroller is at the top. */
export function adminGestureScrollTop(): number {
  const main = document.querySelector("[data-admin-main]");
  if (!(main instanceof HTMLElement) || !elementScrolls(main)) return 1;
  return main.scrollTop;
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

type PullPlace = {
  scrollTop: number;
  thread: HTMLElement | null;
  anchor: ThreadAnchor | "list";
};

function findThreadScroller(target: EventTarget | null): HTMLElement | null {
  const desks = document.querySelectorAll("[data-desk-main]");
  for (const desk of desks) {
    if (!(desk instanceof HTMLElement) || !pullRootVisible(desk)) continue;
    const mark = desk.querySelector("[data-ticket-chat], [data-thread-pull]");
    if (!(mark instanceof HTMLElement) || !pullRootVisible(mark)) continue;
    return closestPullPane(target, desk) ?? solePullPane(desk);
  }
  return null;
}

/** Keep a thread on the newest line, or on the top after a pull from the start. */
export function stickThreadScroll(node: HTMLElement, anchor: "latest" | "start") {
  const apply = () => {
    if (!node.isConnected) return;
    node.setAttribute("data-thread-stick", anchor);
    node.scrollTop = anchor === "start" ? 0 : Math.max(0, node.scrollHeight - node.clientHeight);
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

/**
 * Already-selected phone tab. Callers that own a list pass `allow`.
 * A hidden root must not refresh.
 */
export function usePhoneTabRefresh(onRefresh: () => void, allow?: () => boolean) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const allowRef = useRef(allow);
  allowRef.current = allow;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    function onTab() {
      if (!mq.matches) return;
      if (allowRef.current && !allowRef.current()) return;
      onRefreshRef.current();
    }
    window.addEventListener(PHONE_TAB_REFRESH_EVENT, onTab);
    return () => window.removeEventListener(PHONE_TAB_REFRESH_EVENT, onTab);
  }, []);
}

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
    let startAnchor: PullPlace["anchor"] = "list";
    let threadNode: HTMLElement | null = null;
    let lockNode: HTMLElement | null = null;

    function readPlace(target: EventTarget | null): PullPlace {
      const thread = findThreadScroller(target);
      if (thread) {
        return {
          scrollTop: thread.scrollTop,
          thread,
          anchor: threadScrollAnchor({
            scrollTop: thread.scrollTop,
            scrollHeight: thread.scrollHeight,
            clientHeight: thread.clientHeight,
          }),
        };
      }
      const scrollTop = getScrollTopRef.current ? getScrollTopRef.current(target) : defaultScrollTop();
      return { scrollTop, thread: null, anchor: "list" };
    }

    function pinLatest(node: HTMLElement) {
      const max = Math.max(0, node.scrollHeight - node.clientHeight);
      if (node.scrollTop !== max) node.scrollTop = max;
    }

    function blockMove(event: TouchEvent) {
      if (!lockNode) return;
      if (event.cancelable) event.preventDefault();
      pinLatest(lockNode);
    }

    function armLock(node: HTMLElement) {
      lockNode = node;
      document.addEventListener("touchmove", blockMove, { capture: true, passive: false });
    }

    function clearLock() {
      if (!lockNode) return;
      lockNode = null;
      document.removeEventListener("touchmove", blockMove, { capture: true });
    }

    function disarm() {
      tracking = false;
      clearLock();
      if (armed) setPulling(false);
      armed = false;
    }

    function onStart(event: TouchEvent) {
      if (!mq.matches || event.touches.length !== 1) return;
      if (!pullRootVisible(rootRef.current)) return;
      if (fieldTarget(event.target)) return;
      if (allowRef.current && !allowRef.current()) return;
      const place = readPlace(event.target);
      if (place.thread && place.anchor !== "list") {
        const scrollerTop = place.thread.getBoundingClientRect().top;
        if (
          !threadPullAllowed({
            anchor: place.anchor,
            clientY: event.touches[0].clientY,
            scrollerTop,
          })
        ) {
          return;
        }
      } else if (place.scrollTop > 0) {
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startAnchor = place.anchor;
      threadNode = place.thread;
      tracking = true;
      armed = false;
      if (place.thread && place.anchor === "latest") armLock(place.thread);
    }

    function onMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 1) return;
      const place = readPlace(event.target);
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        disarm();
        return;
      }
      if (startAnchor === "latest") {
        if (place.thread) pinLatest(place.thread);
      } else if (place.scrollTop > 0 || (place.anchor === "older")) {
        disarm();
        return;
      }
      const next = pullRefreshCommit({
        phone: phoneWidth(),
        scrollTop: startAnchor === "latest" ? 0 : place.scrollTop,
        dx,
        dy,
        pinnedLatest: startAnchor === "latest",
      });
      if (next !== armed) {
        armed = next;
        setPulling(next);
      }
    }

    function onEnd() {
      if (!tracking) return;
      const commit = armed && pullRootVisible(rootRef.current);
      const node = threadNode;
      const anchor = startAnchor;
      disarm();
      if (!commit) return;
      if (node && (anchor === "latest" || anchor === "start")) stickThreadScroll(node, anchor);
      onRefreshRef.current();
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
      clearLock();
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
