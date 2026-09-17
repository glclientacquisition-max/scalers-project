"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Occasional overlay. No enter animation.
 * Escape closes. Focus moves to the panel, then returns to the opener.
 */
export function DeskDialog({
  title,
  titleId,
  onClose,
  pending = false,
  panelClassName = "max-w-md",
  children,
}: {
  title: string;
  titleId?: string;
  onClose: () => void;
  pending?: boolean;
  panelClassName?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const headingId = titleId || autoId;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose, pending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      role="presentation"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={[
          "max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl focus:outline-none",
          panelClassName,
        ].join(" ")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={headingId}
            className="font-display text-xl tracking-tight text-ink"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!pending) onClose();
            }}
            className="rounded-lg px-2 py-1 text-sm text-ink-soft hover:bg-surface-canvas hover:text-ink"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
