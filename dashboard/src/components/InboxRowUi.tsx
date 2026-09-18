"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type InboxRowLocal = {
  unread: boolean;
  muted: boolean;
  pinned: boolean;
  assignee: string | null;
  labels: string[];
  snoozed: boolean;
  hidden: boolean;
};

const EMPTY: InboxRowLocal = {
  unread: false,
  muted: false,
  pinned: false,
  assignee: null,
  labels: [],
  snoozed: false,
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
};

const InboxRowUiCtx = createContext<InboxRowUiValue | null>(null);

export function InboxRowUiProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Record<string, InboxRowLocal>>({});
  const [selected, setSelected] = useState<string[]>([]);

  const get = useCallback((id: string) => rows[id] || EMPTY, [rows]);

  const patch = useCallback((id: string, next: Partial<InboxRowLocal>) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || EMPTY), ...next },
    }));
    if (next.hidden || next.snoozed) {
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

  const value = useMemo(
    () => ({
      get,
      patch,
      selected,
      selecting: selected.length > 0,
      enter,
      toggle,
      clear,
    }),
    [get, patch, selected, enter, toggle, clear]
  );
  return <InboxRowUiCtx.Provider value={value}>{children}</InboxRowUiCtx.Provider>;
}

export function useInboxRowUi() {
  return useContext(InboxRowUiCtx);
}

export function useInboxRowLocal(id: string): [InboxRowLocal, (next: Partial<InboxRowLocal>) => void] {
  const ctx = useContext(InboxRowUiCtx);
  if (!ctx) return [EMPTY, () => {}];
  return [ctx.get(id), (next) => ctx.patch(id, next)];
}
