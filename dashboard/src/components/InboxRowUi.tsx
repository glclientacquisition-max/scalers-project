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
};

const InboxRowUiCtx = createContext<InboxRowUiValue | null>(null);

export function InboxRowUiProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Record<string, InboxRowLocal>>({});

  const get = useCallback(
    (id: string) => rows[id] || EMPTY,
    [rows]
  );

  const patch = useCallback((id: string, next: Partial<InboxRowLocal>) => {
    setRows((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || EMPTY), ...next },
    }));
  }, []);

  const value = useMemo(() => ({ get, patch }), [get, patch]);
  return <InboxRowUiCtx.Provider value={value}>{children}</InboxRowUiCtx.Provider>;
}

export function useInboxRowLocal(id: string): [InboxRowLocal, (next: Partial<InboxRowLocal>) => void] {
  const ctx = useContext(InboxRowUiCtx);
  if (!ctx) return [EMPTY, () => {}];
  return [ctx.get(id), (next) => ctx.patch(id, next)];
}
