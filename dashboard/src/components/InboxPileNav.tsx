"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { InboxSelectChrome } from "@/components/InboxRowSelect";
import {
  itemMatchesPurpose,
  orderInboxItems,
  type InboxItem,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import { orderHoldList } from "@/lib/holdSheet";
import { orderVisitList } from "@/lib/runSheet";
import { DEFAULT_PAGE_SIZE } from "@/components/ui/Pagination";
import {
  adjacentPileHrefs,
  filterCachedPile,
} from "@/lib/inboxSwipe";

type InboxPileNavValue = {
  purpose: InboxPurposeFilterId;
  hrefs: Partial<Record<string, string>>;
  listed: InboxItem[];
  pageRows: InboxItem[];
  selectRows: InboxItem[];
  page: number;
  paint: "pending" | "empty" | "rows";
  goPile: (next: string) => void;
  prefetchAdjacent: () => void;
};

const InboxPileNavCtx = createContext<InboxPileNavValue | null>(null);

function orderPile(items: InboxItem[], purpose: InboxPurposeFilterId): InboxItem[] {
  const ordered = orderInboxItems(items, purpose);
  if (purpose === "job") return orderVisitList(ordered);
  if (purpose === "hold") return orderHoldList(ordered);
  return ordered;
}

export function InboxPileNavProvider({
  purpose,
  items,
  hrefs,
  page: urlPage,
  enableSelect = true,
  children,
}: {
  purpose: InboxPurposeFilterId;
  items: InboxItem[];
  hrefs: Partial<Record<string, string>>;
  page: number;
  enableSelect?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [localPurpose, setLocalPurpose] = useState(purpose);
  const [localPage, setLocalPage] = useState(urlPage);
  const pendingRef = useRef<string | null>(null);
  const hrefsRef = useRef(hrefs);
  hrefsRef.current = hrefs;

  useEffect(() => {
    if (pendingRef.current) {
      if (purpose === pendingRef.current) pendingRef.current = null;
      else return;
    }
    setLocalPurpose(purpose);
  }, [purpose]);

  useEffect(() => {
    if (pendingRef.current) return;
    setLocalPage(urlPage);
  }, [urlPage]);

  const prefetchAdjacent = useCallback(() => {
    const { next, prev } = adjacentPileHrefs(localPurpose, hrefsRef.current);
    if (next) router.prefetch(next);
    if (prev) router.prefetch(prev);
  }, [localPurpose, router]);

  useEffect(() => {
    prefetchAdjacent();
  }, [prefetchAdjacent]);

  const goPile = useCallback((next: string) => {
    if (next === localPurpose) return;
    pendingRef.current = next;
    setLocalPurpose(next as InboxPurposeFilterId);
    setLocalPage(1);
    const href = hrefsRef.current[next];
    if (href) router.replace(href);
  }, [localPurpose, router]);

  const { rows, paint } = useMemo(
    () =>
      filterCachedPile(items, localPurpose, (item, pile) =>
        itemMatchesPurpose(item, pile as InboxPurposeFilterId)
      ),
    [items, localPurpose]
  );

  const listed = useMemo(
    () => orderPile(rows, localPurpose),
    [rows, localPurpose]
  );

  const pageRows = useMemo(() => {
    const from = (localPage - 1) * DEFAULT_PAGE_SIZE;
    return listed.slice(from, from + DEFAULT_PAGE_SIZE);
  }, [listed, localPage]);

  const value = useMemo(
    () => ({
      purpose: localPurpose,
      hrefs,
      listed,
      pageRows,
      selectRows: enableSelect ? pageRows : [],
      page: localPage,
      paint,
      goPile,
      prefetchAdjacent,
    }),
    [
      localPurpose,
      hrefs,
      listed,
      pageRows,
      localPage,
      paint,
      goPile,
      prefetchAdjacent,
      enableSelect,
    ]
  );

  return (
    <InboxPileNavCtx.Provider value={value}>{children}</InboxPileNavCtx.Provider>
  );
}

export function useInboxPileNav() {
  return useContext(InboxPileNavCtx);
}

export function InboxPileSelectChrome({ children }: { children: ReactNode }) {
  const nav = useInboxPileNav();
  return <InboxSelectChrome items={nav?.selectRows || []}>{children}</InboxSelectChrome>;
}
