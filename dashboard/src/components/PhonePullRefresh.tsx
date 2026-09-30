"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import { pullRefreshCommit } from "@/lib/endlessList";

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

/**
 * Touch pull on a phone list. No listener work on md+.
 * The callback ref stays current so the listener is bound once.
 */
export function usePhoneListPull(
  rootRef: RefObject<HTMLElement | null>,
  onRefresh: () => void
): boolean {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;

    function disarm() {
      tracking = false;
      if (armed) setPulling(false);
      armed = false;
    }

    function onStart(event: TouchEvent) {
      if (!mq.matches || event.touches.length !== 1) return;
      if (!pullRootVisible(rootRef.current)) return;
      if (fieldTarget(event.target)) return;
      const main = document.querySelector("[data-desk-main]");
      if (!(main instanceof HTMLElement) || main.scrollTop > 0) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
      armed = false;
    }

    function onMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 1) return;
      const main = document.querySelector("[data-desk-main]");
      const scrollTop = main instanceof HTMLElement ? main.scrollTop : 1;
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
      className="flex min-h-11 items-center justify-center md:hidden"
      aria-live="polite"
    >
      <span aria-hidden="true" className={pendingSpinnerInkClass} />
      <span className="sr-only">Loading</span>
    </div>
  );
}
