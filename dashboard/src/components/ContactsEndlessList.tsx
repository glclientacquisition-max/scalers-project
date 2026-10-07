"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loadContactsSlice } from "@/app/(desk)/contacts/listActions";
import { ContactPhoneRow } from "@/components/ContactListRow";
import { EndlessSentinel, scrollDeskWellToTop } from "@/components/EndlessList";
import { PullRefreshMark, pullRootVisible, usePhoneListPull, usePhoneTabRefresh } from "@/components/PhonePullRefresh";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { contactsSliceOutcome } from "@/lib/deskFresh";
import {
  appendUniqueById,
  listAfterPullRefresh,
} from "@/lib/endlessList";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import {
  contactListSections,
  type ContactListRow,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

function ContactsGroupedList({
  rows,
  saved,
  sort,
  q,
  selectedId,
}: {
  rows: ContactListRow[];
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
  selectedId?: string | null;
}) {
  const sections = contactListSections(rows, saved);
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label || "Contacts"}>
          {section.label ? (
            <h2 className="mb-2 px-4 text-meta font-medium uppercase tracking-wide text-ink-3 lg:px-0">
              {section.label}
            </h2>
          ) : null}
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {section.rows.map((row) => (
              <ContactPhoneRow
                key={row.id}
                row={row}
                saved={saved}
                sort={sort}
                q={q}
                selectedId={selectedId}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ContactsEndlessList({
  rows,
  total,
  saved,
  sort,
  q,
  epoch = 0,
  selectedId,
}: {
  rows: ContactListRow[];
  total: number;
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
  epoch?: number;
  selectedId?: string | null;
}) {
  const [extra, setExtra] = useState<ContactListRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const alive = useRef(true);
  const gen = useRef(0);
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const signature = `${epoch}\n${rows.map((row) => row.id).join("\n")}`;
  const [extraFor, setExtraFor] = useState(signature);
  if (extraFor !== signature) {
    gen.current += 1;
    setExtraFor(signature);
    setExtra([]);
    setPage(1);
    setDone(false);
    setError(null);
  }
  const sliceExtra = extraFor === signature ? extra : [];
  const merged = appendUniqueById(rows, sliceExtra).rows;
  const hasMore = !done && merged.length < total;

  useEffect(() => {
    alive.current = true;
    scrollDeskWellToTop();
    return () => {
      alive.current = false;
    };
  }, [saved, sort, q]);

  const loadMore = useCallback(() => {
    if (flight.current || done || merged.length >= total) return;
    flight.current = true;
    setLoading(true);
    const next = page + 1;
    const stamp = gen.current;
    void loadContactsSlice({ page: next, saved, sort, q })
      .then((res) => {
        if (!alive.current || gen.current !== stamp) return;
        const outcome = contactsSliceOutcome({
          error: res.error,
          rowCount: res.rows.length,
        });
        if (outcome === "retry") {
          setError("Could not load contacts.");
          return;
        }
        setError(null);
        if (outcome === "end") {
          setDone(true);
          return;
        }
        const seen = new Set(rows.map((row) => row.id));
        const batch = appendUniqueById(
          extraRef.current,
          res.rows.filter((row) => !seen.has(row.id))
        );
        if (batch.added > 0) {
          extraRef.current = batch.rows;
          setExtra(batch.rows);
          setPage(next);
        }
        if (batch.added === 0 || res.rows.length < DEFAULT_PAGE_SIZE) setDone(true);
      })
      .catch(() => {
        if (!alive.current || gen.current !== stamp) return;
        setError("Could not load contacts.");
      })
      .finally(() => {
        flight.current = false;
        if (alive.current) setLoading(false);
      });
  }, [done, merged.length, page, q, rows, saved, sort, total]);

  return (
    <>
      <DeskLandScope ids={merged.map((row) => row.id)} scopeKey={`${saved}:${sort}:${q}`}>
        <ContactsGroupedList
          rows={merged}
          saved={saved}
          sort={sort}
          q={q}
          selectedId={selectedId}
        />
      </DeskLandScope>
      {error ? (
        <div className="mt-4">
          <DeskError>{error}</DeskError>
        </div>
      ) : null}
      <EndlessSentinel
        hasMore={hasMore}
        loading={loading}
        loaded={merged.length}
        hold={Boolean(error)}
        onLoad={loadMore}
      />
    </>
  );
}

/** Phone pull reloads page 1. A failed pull keeps the rows already on screen. */
export function ContactsPullHost({
  seed,
  total,
  saved,
  sort,
  q,
  empty,
  selectedId,
}: {
  seed: ContactListRow[];
  total: number;
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
  empty: ReactNode;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const flight = useRef(false);
  const [override, setOverride] = useState<ContactListRow[] | null>(null);
  const [overrideTotal, setOverrideTotal] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const filterKey = `${saved}\0${sort}\0${q}`;
  const [errorFor, setErrorFor] = useState(filterKey);
  const seedRef = useRef(seed);
  const seedChanged = seed !== seedRef.current;
  if (seedChanged) {
    seedRef.current = seed;
    setOverride(null);
    setOverrideTotal(null);
  }
  if (errorFor !== filterKey) {
    setErrorFor(filterKey);
    setError(null);
  }
  const shown = seedChanged ? seed : (override ?? seed);
  const shownTotal = seedChanged ? total : (overrideTotal ?? total);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  function refreshList() {
    if (flight.current) return;
    flight.current = true;
    setRefreshing(true);
    void loadContactsSlice({ page: 1, saved, sort, q })
      .then((res) => {
        const next = listAfterPullRefresh(
          shownRef.current,
          res.error ? null : res.rows,
          Boolean(res.error)
        );
        if (!next.reset) {
          setError("Could not load contacts.");
          return;
        }
        setError(null);
        setOverride(next.rows);
        setOverrideTotal(res.total);
        setEpoch((current) => current + 1);
        scrollDeskWellToTop();
        router.refresh();
      })
      .catch(() => {
        setError("Could not load contacts.");
      })
      .finally(() => {
        flight.current = false;
        setRefreshing(false);
      });
  }

  const pulling = usePhoneListPull(rootRef, refreshList);
  usePhoneTabRefresh(refreshList, () => pullRootVisible(rootRef.current));

  return (
    <div ref={rootRef} data-pull-root="" className="min-w-0">
      {error ? (
        <div className="mt-4">
          <DeskError>{error}</DeskError>
        </div>
      ) : null}
      <PullRefreshMark show={pulling || refreshing} />
      {shown.length === 0 ? (
        empty
      ) : (
        <ContactsEndlessList
          key={`${saved}:${sort}:${q}`}
          rows={shown}
          total={shownTotal}
          saved={saved}
          sort={sort}
          q={q}
          epoch={epoch}
          selectedId={selectedId}
        />
      )}
    </div>
  );
}
