"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadContactsSlice } from "@/app/(desk)/contacts/listActions";
import { ContactPhoneRow, ContactTableRow } from "@/components/ContactListRow";
import { EndlessSentinel, scrollDeskWellToTop } from "@/components/EndlessList";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskLandScope } from "@/components/ui/DeskLand";
import {
  appendUniqueById,
  listWindowClass,
} from "@/lib/endlessList";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import {
  contactProfileHref,
  type ContactListRow,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

export function ContactsEndlessList({
  rows,
  total,
  saved,
  sort,
  q,
}: {
  rows: ContactListRow[];
  total: number;
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
}) {
  const [extra, setExtra] = useState<ContactListRow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const flight = useRef(false);
  const alive = useRef(true);
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const merged = appendUniqueById(rows, extra).rows;
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
    void loadContactsSlice({ page: next, saved, sort, q })
      .then((res) => {
        if (!alive.current) return;
        if (res.error || res.rows.length === 0) {
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
      .finally(() => {
        flight.current = false;
        if (alive.current) setLoading(false);
      });
  }, [done, merged.length, page, q, rows, saved, sort, total]);

  return (
    <>
      <DeskLandScope ids={merged.map((row) => row.id)} scopeKey={`${saved}:${sort}:${q}`}>
        <ul
          className={`mt-6 overflow-hidden rounded-2xl border border-line bg-surface md:mt-8 md:hidden ${listWindowClass}`}
        >
          {merged.map((row) => (
            <ContactPhoneRow
              key={row.id}
              row={row}
              href={contactProfileHref(row.id, { saved, sort, q: q || undefined })}
            />
          ))}
        </ul>
        <div className="mt-6 hidden min-w-0 md:mt-8 md:block">
          <DeskDataTable minWidthClass="min-w-0">
            <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-3 lg:py-2"
                >
                  Name
                </th>
                <th
                  scope="col"
                  className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:table-cell lg:px-3 lg:py-2"
                >
                  Phone
                </th>
                <th
                  scope="col"
                  className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-3 lg:py-2"
                >
                  Last call
                </th>
                <th scope="col" className="w-px px-3 py-3 lg:px-3 lg:py-2">
                  <span className="sr-only">Call and WhatsApp</span>
                </th>
              </tr>
            </thead>
            <tbody className={listWindowClass}>
              {merged.map((row) => (
                <ContactTableRow
                  key={row.id}
                  row={row}
                  href={contactProfileHref(row.id, { saved, sort, q: q || undefined })}
                />
              ))}
            </tbody>
          </DeskDataTable>
        </div>
      </DeskLandScope>
      <EndlessSentinel
        hasMore={hasMore}
        loading={loading}
        loaded={merged.length}
        onLoad={loadMore}
      />
    </>
  );
}
