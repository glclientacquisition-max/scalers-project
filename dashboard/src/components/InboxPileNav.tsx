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
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import { inboxArchivedHref } from "@/lib/inboxHref";
import {
  countInboxPurposes,
  itemMatchesPurpose,
  itemMatchesQuery,
  orderInboxItems,
  type InboxItem,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import { orderHoldList } from "@/lib/holdSheet";
import { orderVisitList } from "@/lib/runSheet";
import { scrollDeskWellToTop } from "@/components/EndlessList";
import { nextShown } from "@/lib/endlessList";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import {
  adjacentPileHrefs,
  filterCachedPile,
  inboxPileHref,
  SWIPE_PILES,
} from "@/lib/inboxSwipe";

type InboxPileNavValue = {
  purpose: InboxPurposeFilterId;
  q: string;
  hrefs: Partial<Record<string, string>>;
  listed: InboxItem[];
  pageRows: InboxItem[];
  selectRows: InboxItem[];
  counts: Record<InboxPurposeFilterId, number>;
  page: number;
  hasMore: boolean;
  loadMore: () => void;
  paint: "pending" | "empty" | "rows";
  goPile: (next: string) => void;
  setQuery: (next: string) => void;
  prefetchAdjacent: () => void;
};

const InboxPileNavCtx = createContext<InboxPileNavValue | null>(null);

function orderPile(items: InboxItem[], purpose: InboxPurposeFilterId): InboxItem[] {
  const ordered = orderInboxItems(items, purpose);
  if (purpose === "job") return orderVisitList(ordered);
  if (purpose === "hold") return orderHoldList(ordered);
  return ordered;
}

function inboxSearchHref(opts: {
  purpose: string;
  q: string;
  view?: string;
  week?: string;
  day?: string;
  from?: string;
  rpage?: string;
}): string {
  const text = sanitizeSearchQuery(opts.q);
  if (opts.purpose === "archived") {
    return inboxArchivedHref({
      purpose: opts.from,
      view: opts.view,
      week: opts.week,
      day: opts.day,
      page: opts.rpage,
      q: text || undefined,
    });
  }
  return inboxPileHref(opts.purpose, {
    q: text,
    active: opts.purpose,
    view: opts.view,
    week: opts.week,
    day: opts.day,
  });
}

export function InboxPileNavProvider({
  purpose,
  items,
  hrefs,
  q: urlQ = "",
  view,
  week,
  day,
  from,
  rpage,
  enableSelect = true,
  children,
}: {
  purpose: InboxPurposeFilterId;
  items: InboxItem[];
  hrefs: Partial<Record<string, string>>;
  q?: string;
  view?: string;
  week?: string;
  day?: string;
  from?: string;
  rpage?: string;
  enableSelect?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [localPurpose, setLocalPurpose] = useState(purpose);
  const [localQ, setLocalQ] = useState(urlQ);
  const filterKey = `${localPurpose}\0${localQ.trim()}`;
  const [shown, setShown] = useState(DEFAULT_PAGE_SIZE);
  const [shownFor, setShownFor] = useState(filterKey);
  if (shownFor !== filterKey) {
    setShownFor(filterKey);
    setShown(DEFAULT_PAGE_SIZE);
  }
  const windowCount = shownFor === filterKey ? shown : DEFAULT_PAGE_SIZE;
  const pendingRef = useRef<string | null>(null);
  const pendingQRef = useRef<string | null>(null);
  const qWait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hrefsRef = useRef(hrefs);
  const purposeRef = useRef(localPurpose);
  const qRef = useRef(localQ);
  const searchOptsRef = useRef({ view, week, day, from, rpage });
  purposeRef.current = localPurpose;
  qRef.current = localQ;
  searchOptsRef.current = { view, week, day, from, rpage };

  useEffect(() => {
    if (pendingRef.current) {
      if (purpose === pendingRef.current) pendingRef.current = null;
      else return;
    }
    setLocalPurpose(purpose);
  }, [purpose]);

  useEffect(() => {
    if (pendingQRef.current !== null) {
      if (
        urlQ === pendingQRef.current ||
        urlQ === sanitizeSearchQuery(pendingQRef.current)
      ) {
        pendingQRef.current = null;
      }
      return;
    }
    setLocalQ(urlQ);
  }, [urlQ]);

  useEffect(
    () => () => {
      if (qWait.current) clearTimeout(qWait.current);
    },
    []
  );

  const liveHrefs = useMemo(() => {
    const opts = {
      q: localQ.trim(),
      active: localPurpose,
      view,
      week,
      day,
    };
    const ids = Object.keys(hrefs).length ? Object.keys(hrefs) : [...SWIPE_PILES];
    return Object.fromEntries(
      ids.map((id) => [id, inboxPileHref(id, opts)])
    ) as Partial<Record<string, string>>;
  }, [hrefs, localQ, localPurpose, view, week, day]);

  hrefsRef.current = liveHrefs;

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
    purposeRef.current = next as InboxPurposeFilterId;
    const href = hrefsRef.current[next];
    if (href) router.replace(href);
  }, [localPurpose, router]);

  const setQuery = useCallback((next: string) => {
    const value = next.slice(0, 64);
    setLocalQ(value);
    qRef.current = value;
    pendingQRef.current = value;
    if (qWait.current) clearTimeout(qWait.current);
    const sync = () => {
      const opts = searchOptsRef.current;
      router.replace(
        inboxSearchHref({
          purpose: purposeRef.current,
          q: qRef.current,
          view: opts.view,
          week: opts.week,
          day: opts.day,
          from: opts.from,
          rpage: opts.rpage,
        })
      );
    };
    if (!value.trim()) {
      sync();
      return;
    }
    qWait.current = setTimeout(sync, 300);
  }, [router]);

  const searched = useMemo(() => {
    const text = localQ.trim();
    if (!text) return items;
    return items.filter((item) => itemMatchesQuery(item, text));
  }, [items, localQ]);

  const counts = useMemo(() => countInboxPurposes(searched), [searched]);

  const { rows, paint } = useMemo(
    () =>
      filterCachedPile(searched, localPurpose, (item, pile) =>
        itemMatchesPurpose(item, pile as InboxPurposeFilterId)
      ),
    [searched, localPurpose]
  );

  const listed = useMemo(
    () => orderPile(rows, localPurpose),
    [rows, localPurpose]
  );

  useEffect(() => {
    scrollDeskWellToTop();
  }, [filterKey]);

  const pageRows = useMemo(
    () => listed.slice(0, windowCount),
    [listed, windowCount]
  );
  const hasMore = pageRows.length < listed.length;
  const loadMore = useCallback(() => {
    setShown((current) => nextShown(current, listed.length, DEFAULT_PAGE_SIZE));
  }, [listed.length]);

  const value = useMemo(
    () => ({
      purpose: localPurpose,
      q: localQ,
      hrefs: liveHrefs,
      listed,
      pageRows,
      selectRows: enableSelect ? pageRows : [],
      counts,
      page: 1,
      hasMore,
      loadMore,
      paint,
      goPile,
      setQuery,
      prefetchAdjacent,
    }),
    [
      localPurpose,
      localQ,
      liveHrefs,
      listed,
      pageRows,
      hasMore,
      loadMore,
      paint,
      goPile,
      setQuery,
      prefetchAdjacent,
      enableSelect,
      counts,
    ]
  );

  return (
    <InboxPileNavCtx.Provider value={value}>{children}</InboxPileNavCtx.Provider>
  );
}

export function useInboxPileNav() {
  return useContext(InboxPileNavCtx);
}

export function useInboxQueryItems(items: InboxItem[]): InboxItem[] {
  const nav = useInboxPileNav();
  const q = (nav?.q ?? "").trim();
  return useMemo(
    () => (q ? items.filter((item) => itemMatchesQuery(item, q)) : items),
    [items, q]
  );
}

export function InboxPileSelectChrome({ children }: { children: ReactNode }) {
  const nav = useInboxPileNav();
  return <InboxSelectChrome items={nav?.selectRows || []}>{children}</InboxSelectChrome>;
}
