"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Name for an icon-only control. Shows on hover and focus. Portaled so desk
 * overflow clip does not hide it. Visual only. The control keeps aria-label.
 */
export function DeskHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const place = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setPos({ top: box.top + box.height / 2, left: box.right + 8 });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      place();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, place]);

  const tip =
    mounted && open ? (
      <span
        role="tooltip"
        aria-hidden="true"
        style={{ top: pos.top, left: pos.left }}
        className="pointer-events-none fixed z-[80] -translate-y-1/2 rounded-lg bg-ink px-2 py-1 text-xs font-medium text-surface"
      >
        {label}
      </span>
    ) : null;

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hide();
      }}
    >
      {children}
      {tip ? createPortal(tip, document.body) : null}
    </span>
  );
}
