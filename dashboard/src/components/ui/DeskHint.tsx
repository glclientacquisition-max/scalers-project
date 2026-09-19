"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "end" | "top";

function place(box: DOMRect, prefer: Side): { top: number; left: number; side: Side } {
  const gap = 8;
  const pad = 8;
  const guessW = 112;
  const endFits = box.right + gap + guessW <= window.innerWidth - pad;
  const side: Side = prefer === "top" || !endFits ? "top" : "end";
  if (side === "end") {
    return {
      top: Math.min(window.innerHeight - pad, Math.max(pad, box.top + box.height / 2)),
      left: box.right + gap,
      side,
    };
  }
  return {
    top: Math.max(pad, box.top - gap),
    left: Math.min(window.innerWidth - pad, Math.max(pad, box.left + box.width / 2)),
    side,
  };
}

/**
 * Name for an icon-only control. Shows on hover, pointer, and focus. Portaled so
 * desk overflow clip cannot hide it. Navy chip so it stays readable outside
 * `.desk-theme`. Escape and scroll dismiss. Visual only. The control keeps aria-label.
 */
export function DeskHint({
  label,
  children,
  side = "end",
  className,
}: {
  label: string;
  children: ReactNode;
  side?: Side;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const preferRef = useRef(side);
  preferRef.current = side;
  const [tip, setTip] = useState<{ top: number; left: number; side: Side } | null>(
    null
  );

  const show = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    setTip(place(node.getBoundingClientRect(), preferRef.current));
  }, []);

  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }
    function onReposition() {
      const node = wrapRef.current;
      if (!node) return;
      setTip(place(node.getBoundingClientRect(), preferRef.current));
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [tip, hide]);

  return (
    <span
      ref={wrapRef}
      className={["relative", className || "inline-flex"].join(" ")}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
      }}
    >
      {children}
      {tip && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              data-desk-hint={label}
              aria-hidden="true"
              style={{ top: tip.top, left: tip.left, zIndex: 9999 }}
              className={[
                "pointer-events-none fixed whitespace-nowrap rounded-lg bg-[#0A192F] px-2 py-1 text-xs font-medium text-white shadow-md",
                tip.side === "end" ? "-translate-y-1/2" : "-translate-x-1/2 -translate-y-full",
              ].join(" ")}
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
