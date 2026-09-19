"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { InboxArchiveToast } from "@/components/InboxArchiveToast";
import type { InboxTeammateOption } from "@/lib/inboxTriage";
import {
  clearInboxArchiveUndo,
  readInboxArchiveUndo,
  INBOX_ARCHIVE_UNDO_EVENT,
  type InboxArchiveUndoPayload,
  type InboxArchiveUndoRow,
} from "@/lib/inboxArchiveUndo";

export type InboxRowLocal = {
  hidden: boolean;
};

const EMPTY: InboxRowLocal = {
  hidden: false,
};

type InboxRowUiValue = {
  get: (id: string) => InboxRowLocal;
  patch: (id: string, next: Partial<InboxRowLocal>) => void;
  selected: string[];
  selecting: boolean;
  enter: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  teammates: InboxTeammateOption[];
};

const InboxRowUiCtx = createContext<InboxRowUiValue | null>(null);

function hideArchiveRows(
  setRows: Dispatch<SetStateAction<Record<string, InboxRowLocal>>>,
  rows: InboxArchiveUndoRow[]
) {
  setRows((prev) => {
    const next = { ...prev };
    for (const row of rows) {
      next[row.id] = { ...(next[row.id] || EMPTY), hidden: true };
      if (row.callId !== row.id) {
        next[row.callId] = { ...(next[row.callId] || EMPTY), hidden: true };
      }
    }
    return next;
  });
}

export function InboxRowUiProvider({
  children,
  teammates = [],
}: {
  children: ReactNode;
  teammates?: InboxTeammateOption[];
}) {
  const [rows, setRows] = useState<Record<string, InboxRowLocal>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [archiveNotice, setArchiveNotice] = useState<InboxArchiveUndoPayload | null>(null);

  const get = useCallback((id: string) => rows[id] || EMPTY, [rows]);

  const patch = useCallback((id: string, next: Partial<InboxRowLocal>) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || EMPTY), ...next },
    }));
    if (next.hidden) {
      setSelected((prev) => prev.filter((item) => item !== id));
    }
  }, []);

  const enter = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const dismissArchive = useCallback(() => {
    clearInboxArchiveUndo();
    setArchiveNotice(null);
  }, []);

  const applyArchiveNotice = useCallback((payload: InboxArchiveUndoPayload | null) => {
    if (!payload?.rows.length) return;
    hideArchiveRows(setRows, payload.rows);
    const gone = new Set(payload.rows.flatMap((row) => [row.id, row.callId]));
    setSelected((prev) => prev.filter((id) => !gone.has(id)));
    setArchiveNotice(payload);
  }, []);

  useEffect(() => {
    applyArchiveNotice(readInboxArchiveUndo());
    function onNotice(event: Event) {
      const detail = (event as CustomEvent<InboxArchiveUndoPayload>).detail;
      applyArchiveNotice(detail);
    }
    window.addEventListener(INBOX_ARCHIVE_UNDO_EVENT, onNotice);
    return () => window.removeEventListener(INBOX_ARCHIVE_UNDO_EVENT, onNotice);
  }, [applyArchiveNotice]);

  useEffect(() => {
    if (!archiveNotice) return;
    const timer = setTimeout(
      () => dismissArchive(),
      Math.max(0, archiveNotice.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [archiveNotice, dismissArchive]);

  const value = useMemo(
    () => ({
      get,
      patch,
      selected,
      selecting: selected.length > 0,
      enter,
      toggle,
      clear,
      teammates,
    }),
    [get, patch, selected, enter, toggle, clear, teammates]
  );
  return (
    <InboxRowUiCtx.Provider value={value}>
      {children}
      <InboxArchiveToast notice={archiveNotice} patch={patch} dismissArchive={dismissArchive} />
    </InboxRowUiCtx.Provider>
  );
}

export function useInboxRowUi() {
  return useContext(InboxRowUiCtx);
}

export function useInboxRowLocal(id: string): [InboxRowLocal, (next: Partial<InboxRowLocal>) => void] {
  const ctx = useContext(InboxRowUiCtx);
  if (!ctx) return [EMPTY, () => {}];
  return [ctx.get(id), (next) => ctx.patch(id, next)];
}
