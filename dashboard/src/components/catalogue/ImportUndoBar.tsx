"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IMPORT_UNDO_WINDOW_MS } from "@/lib/importUndo";

export type UndoOutcome = { ok: boolean; text: string };

/** "9:41" from milliseconds left. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const R = 18;
const C = 2 * Math.PI * R;

/** A ring that empties over the 10 minutes, with the time left in the middle. Steps once a second (no animation). */
function CountdownRing({ left }: { left: number }) {
  const frac = Math.max(0, Math.min(1, left / IMPORT_UNDO_WINDOW_MS));
  return (
    <span className="relative inline-grid size-12 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="absolute inset-0 size-12 -rotate-90">
        <circle cx="22" cy="22" r={R} fill="none" strokeWidth="3.5" className="stroke-hairline" />
        <circle cx="22" cy="22" r={R} fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-accent" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <span className="text-caption font-semibold tabular-nums text-ink">{mmss(left)}</span>
    </span>
  );
}

/**
 * Shown on the Catalogue for 10 minutes after an Add many import: a live countdown ring, what changed, and one Undo
 * button. After a tap it says plainly whether the import was put back or why it could not be.
 */
export function ImportUndoBar({
  at,
  summary,
  pending,
  outcome,
  onUndo,
  onExpire,
  onDismiss,
}: {
  at: number;
  summary: string;
  pending: boolean;
  outcome?: UndoOutcome | null;
  onUndo: () => void;
  onExpire: () => void;
  onDismiss?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (outcome) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [outcome]);
  const left = at + IMPORT_UNDO_WINDOW_MS - now;
  useEffect(() => {
    if (!outcome && left <= 0) onExpire();
  }, [left, onExpire, outcome]);
  if (outcome) {
    return (
      <div
        className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 py-3 ${outcome.ok ? "bg-surface-2" : "bg-attention-tonal"}`}
        role={outcome.ok ? "status" : "alert"}
        aria-live="polite"
        data-import-undo=""
        data-undo-outcome={outcome.ok ? "done" : "refused"}
      >
        <p className={`min-w-0 text-body ${outcome.ok ? "text-ink" : "text-attention"}`}>{outcome.text}</p>
        {onDismiss ? (
          <Button variant="ghost" size="md" className="min-h-11" onClick={onDismiss}>
            OK
          </Button>
        ) : null}
      </div>
    );
  }
  if (left <= 0) return null;
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2" role="status" data-import-undo="">
      <CountdownRing left={left} />
      <p className="min-w-0 flex-1 text-body text-ink">
        {summary}
        <span className="block text-meta text-ink-2">
          <span className="sr-only">{`Undo open for about ${Math.ceil(left / 60000)} minutes. `}</span>
          <span aria-hidden="true">{`You can undo for ${mmss(left)}.`}</span>
        </span>
      </p>
      <Button variant="tonal" size="md" className="min-h-11 min-w-11 shrink-0" pending={pending} onClick={onUndo} data-import-undo-button="">
        Undo
      </Button>
    </div>
  );
}
