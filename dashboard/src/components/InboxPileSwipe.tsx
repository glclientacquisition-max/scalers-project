"use client";

import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { deskShiftClass } from "@/components/ui/deskChrome";
import {
  purposeAfterSwipe,
  swipePileCommit,
} from "@/lib/inboxSwipe";

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function InboxPileSwipe({
  active,
  hrefs,
  enabled = true,
  children,
}: {
  active: string;
  hrefs: Partial<Record<string, string>>;
  enabled?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const ui = useInboxRowUi();
  const startRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const ignoreClickRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  function setShift(px: number, animate: boolean) {
    const node = surfaceRef.current;
    if (!node) return;
    node.style.transition = animate ? "" : "none";
    if (!px || reduceMotion()) {
      node.style.transform = "";
      return;
    }
    node.style.transform = `translateX(${px}px)`;
  }

  function armed() {
    return enabled && !ui?.selecting;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!armed()) return;
    if (event.pointerType !== "touch") return;
    startRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    axisRef.current = null;
    ignoreClickRef.current = false;
    setShift(0, false);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (!start || start.id !== event.pointerId) return;
    if (event.pointerType !== "touch") return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!axisRef.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (axisRef.current === "h") {
        event.currentTarget.setPointerCapture(event.pointerId);
      } else {
        startRef.current = null;
        setShift(0, false);
        return;
      }
    }
    if (axisRef.current !== "h") return;
    ignoreClickRef.current = true;
    setShift(dx * 0.28, false);
  }

  function endGesture(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const start = startRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    startRef.current = null;
    const axis = axisRef.current;
    axisRef.current = null;
    setShift(0, true);
    if (axis !== "h") return;
    ignoreClickRef.current = true;
    if (!commit) return;
    const dir = swipePileCommit({
      dx,
      dy,
      pointerType: event.pointerType,
      selecting: Boolean(ui?.selecting),
    });
    const next = purposeAfterSwipe(active, dir);
    const href = next ? hrefs[next] : undefined;
    if (href) router.push(href);
  }

  return (
    <div
      ref={surfaceRef}
      className={`touch-pan-y min-w-0 ${deskShiftClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endGesture(event, true)}
      onPointerCancel={(event) => endGesture(event, false)}
      onClickCapture={(event) => {
        if (!ignoreClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        ignoreClickRef.current = false;
      }}
    >
      {children}
    </div>
  );
}
