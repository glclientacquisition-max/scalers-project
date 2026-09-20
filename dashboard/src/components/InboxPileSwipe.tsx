"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { useInboxPileNav } from "@/components/InboxPileNav";
import { deskShiftClass } from "@/components/ui/deskChrome";
import {
  adjacentPileHrefs,
  inboxSwipeCommitPx,
  inboxSwipeFollowPx,
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
  const nav = useInboxPileNav();
  const ui = useInboxRowUi();
  const purpose = nav?.purpose ?? active;
  const pileHrefs = nav?.hrefs ?? hrefs;
  const startRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const axisRef = useRef<"h" | "v" | null>(null);
  const ignoreClickRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const liveDxRef = useRef(0);

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

  useEffect(() => {
    const adj = adjacentPileHrefs(purpose, pileHrefs);
    if (nav) {
      nav.prefetchAdjacent();
      return;
    }
    if (adj.next) router.prefetch(adj.next);
    if (adj.prev) router.prefetch(adj.prev);
  }, [nav, purpose, pileHrefs, router]);

  function goPile(next: string) {
    const href = pileHrefs[next];
    if (!href) return;
    if (nav) {
      nav.goPile(next);
      return;
    }
    router.replace(href);
  }

  function finishThen(px: number, then: () => void) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      const node = surfaceRef.current;
      if (node) node.removeEventListener("transitionend", onEnd);
      setShift(0, false);
      then();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "transform") return;
      run();
    };
    const node = surfaceRef.current;
    if (!node || reduceMotion() || !px) {
      run();
      return;
    }
    node.addEventListener("transitionend", onEnd);
    setShift(px, true);
    window.setTimeout(run, 200);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!armed()) return;
    if (event.pointerType !== "touch") return;
    startRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    axisRef.current = null;
    ignoreClickRef.current = false;
    liveDxRef.current = 0;
    setShift(0, false);
    if (nav) nav.prefetchAdjacent();
    else {
      const adjNow = adjacentPileHrefs(purpose, pileHrefs);
      if (adjNow.next) router.prefetch(adjNow.next);
      if (adjNow.prev) router.prefetch(adjNow.prev);
    }
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
    liveDxRef.current = dx;
    setShift(inboxSwipeFollowPx(dx), false);
  }

  function endGesture(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const start = startRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x || liveDxRef.current;
    const dy = event.clientY - start.y;
    startRef.current = null;
    const axis = axisRef.current;
    axisRef.current = null;
    if (axis !== "h") {
      setShift(0, true);
      return;
    }
    ignoreClickRef.current = true;
    if (!commit) {
      setShift(0, true);
      return;
    }
    const dir = swipePileCommit({
      dx,
      dy,
      pointerType: event.pointerType,
      selecting: Boolean(ui?.selecting),
    });
    const next = purposeAfterSwipe(purpose, dir);
    if (!next || !pileHrefs[next]) {
      setShift(0, true);
      return;
    }
    finishThen(inboxSwipeCommitPx(dir), () => goPile(next));
  }

  const adj = adjacentPileHrefs(purpose, pileHrefs);

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
      {adj.next ? (
        <Link href={adj.next} prefetch className="hidden" tabIndex={-1} aria-hidden="true" />
      ) : null}
      {adj.prev ? (
        <Link href={adj.prev} prefetch className="hidden" tabIndex={-1} aria-hidden="true" />
      ) : null}
      {children}
    </div>
  );
}
