"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Name for an icon-only control. Shows on hover, pointer, and focus. Portaled so
 * desk overflow clip cannot hide it. Visual only. The control keeps aria-label.
 */
export function DeskHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setTip({ top: box.top + box.height / 2, left: box.right + 8 });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setTip(null);
    }
    function onReposition() {
      const node = wrapRef.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      setTip({ top: box.top + box.height / 2, left: box.right + 8 });
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [tip]);

  return (
    <span
      ref={wrapRef}
      title={label}
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
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
              aria-hidden="true"
              style={{ top: tip.top, left: tip.left, zIndex: 9999 }}
              className="pointer-events-none fixed -translate-y-1/2 rounded-lg bg-ink px-2 py-1 text-xs font-medium text-surface shadow-md"
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
