"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { undoMinutesLeft } from "@/lib/importUndo";

/** Shown on the Catalogue for 10 minutes after an Add many import. One tap puts the list back. */
export function ImportUndoBar({
  at,
  summary,
  pending,
  onUndo,
  onExpire,
}: {
  at: number;
  summary: string;
  pending: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const left = undoMinutesLeft(at, now);
  useEffect(() => {
    if (left <= 0) onExpire();
  }, [left, onExpire]);
  if (left <= 0) return null;
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-2" role="status" aria-live="polite" data-import-undo="">
      <p className="min-w-0 text-body text-ink">
        {summary}
        <span className="block text-meta text-ink-2">Undo is open for {left} more {left === 1 ? "minute" : "minutes"}.</span>
      </p>
      <Button variant="tonal" size="md" pending={pending} onClick={onUndo} data-import-undo-button="">
        Undo import
      </Button>
    </div>
  );
}
