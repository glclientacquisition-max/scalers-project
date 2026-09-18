"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { InboxColumn, InboxThread } from "@/components/InboxColumn";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  INBOX_LIST_MAX,
  INBOX_LIST_MIN,
  INBOX_SPLIT_KEY,
  clampInboxListWidth,
  inboxListDefaultWidth,
} from "@/lib/inboxSplit";

/**
 * md+ list | thread. Drag or arrow keys change list width. Phone stays full list or full call.
 */
export function InboxSplit({
  list,
  thread,
}: {
  list: ReactNode;
  thread: ReactNode;
}) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [parentWidth, setParentWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef<number | null>(null);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const persist = useCallback((next: number | null) => {
    setWidth(next);
    try {
      if (next == null) localStorage.removeItem(INBOX_SPLIT_KEY);
      else localStorage.setItem(INBOX_SPLIT_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INBOX_SPLIT_KEY);
      const next = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(next)) setWidth(next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const node = splitRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const box = node.getBoundingClientRect();
      setParentWidth(box.width);
      const current = widthRef.current;
      if (current == null) return;
      const next = clampInboxListWidth(current, box.width);
      if (next !== current) persist(next);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [persist]);

  const applyFromClientX = useCallback(
    (clientX: number) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (!box) return;
      persist(clampInboxListWidth(clientX - box.left, box.width));
    },
    [persist]
  );

  useEffect(() => {
    if (!dragging) return;
    function move(event: PointerEvent) {
      applyFromClientX(event.clientX);
    }
    function up() {
      setDragging(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, applyFromClientX]);

  const valueNow =
    width ??
    (parentWidth > 0 ? inboxListDefaultWidth(parentWidth) : INBOX_LIST_MIN);
  const valueMax =
    parentWidth > 0 ? clampInboxListWidth(INBOX_LIST_MAX, parentWidth) : INBOX_LIST_MAX;

  return (
    <div
      ref={splitRef}
      data-desk-bleed
      className={[
        "flex min-h-0 flex-1 flex-col md:h-full md:flex-row md:items-stretch md:overflow-hidden",
        dragging ? "select-none" : "",
      ].join(" ")}
    >
      <InboxColumn width={width}>{list}</InboxColumn>
      <DeskHint label="List width" className="z-10 hidden h-full w-px shrink-0 md:flex">
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Inbox list width"
          aria-valuemin={INBOX_LIST_MIN}
          aria-valuemax={valueMax}
          aria-valuenow={Math.min(valueMax, Math.max(INBOX_LIST_MIN, valueNow))}
          tabIndex={0}
          onPointerDown={(event) => {
            event.preventDefault();
            (event.target as HTMLElement).focus();
            setDragging(true);
            applyFromClientX(event.clientX);
          }}
          onDoubleClick={() => persist(null)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const box = splitRef.current?.getBoundingClientRect();
            if (!box) return;
            const current = widthRef.current ?? inboxListDefaultWidth(box.width);
            const step = event.key === "ArrowLeft" ? -16 : 16;
            persist(clampInboxListWidth(current + step, box.width));
          }}
          className={[
            "relative h-full w-px shrink-0 cursor-col-resize touch-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className={[
              "absolute inset-y-0 left-1/2 z-10 w-6 -translate-x-1/2",
              dragging ? "bg-accent/15" : "hover:bg-accent/10",
            ].join(" ")}
          />
          <span
            aria-hidden="true"
            className={[
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
              dragging ? "bg-accent" : "bg-line",
            ].join(" ")}
          />
        </div>
      </DeskHint>
      <InboxThread>{thread}</InboxThread>
    </div>
  );
}
