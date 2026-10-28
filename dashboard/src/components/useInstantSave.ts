"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardSaveState } from "@/components/policies/policiesKit";

const SAVED_FOR_MS = 8000;
const OFFLINE_COPY = "Couldn't save. Check your connection and try again.";

export type InstantSaveResult<V> = { ok: true; value: V } | { ok: false; error: string };

/**
 * One control that saves the moment it changes (a switch or a tick), like a Policies card:
 * the new value shows at once, then Saving, then Saved with Undo for a few seconds. A failure
 * puts the old value back and offers Try again. A later change wins over an earlier reply.
 */
export function useInstantSave<V>(initial: V, save: (next: V) => Promise<InstantSaveResult<V>>) {
  const [value, setValue] = useState<V>(initial);
  const [status, setStatus] = useState<CardSaveState>({ state: "idle" });
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const commit = useCallback(
    async (next: V, prev: V, undoable: boolean) => {
      const n = ++seq.current;
      if (timer.current) clearTimeout(timer.current);
      setValue(next);
      setStatus({ state: "saving" });
      let res: InstantSaveResult<V>;
      try {
        res = await save(next);
      } catch {
        res = { ok: false, error: OFFLINE_COPY };
      }
      if (n !== seq.current) return;
      if (!res.ok) {
        setValue(prev);
        setStatus({ state: "error", error: res.error || OFFLINE_COPY, retry: () => void commit(next, prev, undoable) });
        return;
      }
      const saved = res.value;
      setValue(saved);
      setStatus({ state: "saved", undo: undoable ? () => void commit(prev, saved, false) : undefined });
      timer.current = setTimeout(() => setStatus({ state: "idle" }), SAVED_FOR_MS);
    },
    [save],
  );

  const change = useCallback((next: V) => void commit(next, value, true), [commit, value]);
  return { value, status, change };
}
