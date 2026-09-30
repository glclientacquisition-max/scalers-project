"use client";

import Link from "next/link";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { callsHref } from "@/lib/callsTriage";
import { nicheCopy } from "@/lib/inboxNiche";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import {
  InboxPhoneRow,
  InboxTableRow,
  inboxTableKind,
} from "@/components/InboxItemRow";
import { InboxArchivedPhoneRow, InboxArchivedTableRow } from "@/components/InboxArchivedRow";
import type { InboxReturn } from "@/lib/inboxHref";
import { InboxPileSwipe } from "@/components/InboxPileSwipe";
import { useInboxPileNav } from "@/components/InboxPileNav";
import { useInboxRowUi } from "@/components/InboxRowUi";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { btnGhost, btnPrimary, deskEmptyClass, deskShiftClass, pendingSpinnerInkClass } from "@/components/ui/deskChrome";

function InboxHeaderCheck() {
  const nav = useInboxPileNav();
  const ui = useInboxRowUi();
  const rows = nav?.selectRows || [];
  if (!ui || rows.length === 0) return null;
  const ids = rows.map((row) => row.id);
  const selected = new Set(ui.selected);
  const allOn = ids.every((id) => selected.has(id));
  return (
    <label className="inline-flex h-11 w-11 shrink-0 items-center justify-center">
      <span className="sr-only">{allOn ? "Clear" : "Select all"}</span>
      <input
        type="checkbox"
        checked={allOn}
        onChange={() => (allOn ? ui.clear() : ui.replace(ids))}
        aria-label={allOn ? "Clear" : "Select all"}
        className="h-6 w-6 shrink-0 accent-[#005CCC] focus:outline-none focus:ring-2 focus:ring-[#0096FF] lg:h-4 lg:w-4"
      />
    </label>
  );
}

function EmptyInbox({
  total,
  pendingDid,
  did,
  purpose,
  q,
  vertical,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
  purpose: InboxPurposeFilterId;
  q: string;
  vertical?: string | null;
}) {
  const nav = useInboxPileNav();
  const copy = nicheCopy(vertical);
  const query = (nav?.q ?? q).trim();
  if (query) {
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">No matches</p>
        {nav ? (
          <button
            type="button"
            onClick={() => nav.setQuery("")}
            className={`mt-6 inline-flex min-h-11 items-center font-medium text-ink-soft ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            Clear
          </button>
        ) : (
          <Link
            href={callsHref({ purpose })}
            className={`mt-6 inline-flex min-h-11 items-center font-medium text-ink-soft ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            Clear
          </Link>
        )}
      </div>
    );
  }

  if (total > 0) {
    const emptyLabel =
      purpose === "hold"
        ? copy.holdEmpty
        : purpose === "job"
          ? copy.jobEmpty
          : purpose === "needs"
            ? "Nothing needs you"
            : purpose === "archived"
              ? "None archived"
              : "Nothing in this filter";
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">{emptyLabel}</p>
        <Link
          href={callsHref({ purpose: "all" })}
          className={`${btnGhost} mt-6`}
        >
          Show all
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-8 border-y border-accent/30 bg-accent/5 py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">Number being assigned</p>
        <Link
          href={businessSettingsHref("train")}
          className={`${btnPrimary} mt-6 px-5`}
        >
          Train
        </Link>
      </div>
    );
  }

  return (
    <div className={deskEmptyClass}>
      <p className="font-display text-2xl tracking-tight text-ink">Inbox is empty</p>
      {did ? (
        <a href={`tel:${did}`} className={`${btnGhost} mt-6`}>
          {did}
        </a>
      ) : (
        <Link href={businessSettingsHref("test")} className={`${btnGhost} mt-6`}>
          Test line
        </Link>
      )}
    </div>
  );
}

export function InboxPileBoard({
  assembledCount,
  pendingDid,
  did,
  q: urlQ,
  vertical,
  businessName,
  counts: urlCounts,
  inboxRet,
  viewParams,
  hrefs,
}: {
  assembledCount: number;
  pendingDid: boolean;
  did: string;
  q: string;
  vertical?: string | null;
  businessName: string;
  counts: Record<InboxPurposeFilterId, number>;
  inboxRet: InboxReturn;
  viewParams: Record<string, string | undefined>;
  hrefs: Partial<Record<string, string>>;
}) {
  const nav = useInboxPileNav();
  const purpose = nav?.purpose ?? "all";
  const listed = nav?.listed || [];
  const pageRows = nav?.pageRows || [];
  const page = nav?.page ?? 1;
  const paint = nav?.paint ?? "rows";
  const q = (nav?.q ?? urlQ).trim();
  const counts = nav?.counts ?? urlCounts;
  const pileHrefs = nav?.hrefs ?? hrefs;
  const copy = nicheCopy(vertical);
  const ret: InboxReturn = { ...inboxRet, purpose, page, q: q || undefined };
  const showArchivedEntry =
    purpose !== "archived" && counts.archived > 0 && page === 1;
  const empty =
    paint !== "pending" && pageRows.length === 0 && !showArchivedEntry;

  return (
    <>
      {paint === "pending" ? (
        <InboxPileSwipe
          active={purpose}
          hrefs={pileHrefs}
          enabled={purpose !== "archived"}
        >
          <div className={deskEmptyClass}>
            <span aria-hidden="true" className={pendingSpinnerInkClass} />
          </div>
        </InboxPileSwipe>
      ) : empty ? (
        <InboxPileSwipe
          active={purpose}
          hrefs={pileHrefs}
          enabled={purpose !== "archived"}
        >
          <EmptyInbox
            total={assembledCount}
            pendingDid={pendingDid}
            did={did}
            purpose={purpose}
            q={q}
            vertical={vertical}
          />
        </InboxPileSwipe>
      ) : (
        <>
          <InboxPileSwipe
            active={purpose}
            hrefs={pileHrefs}
            enabled={purpose !== "archived"}
          >
            <DeskLandScope
              ids={pageRows.map((item) => item.id)}
              scopeKey={`${purpose}:${page}:${q}`}
            >
              <ul className="mt-8 list-none overflow-hidden rounded-2xl border border-line bg-surface lg:hidden">
                {showArchivedEntry ? (
                  <InboxArchivedPhoneRow count={counts.archived} ret={ret} />
                ) : null}
                {pageRows.map((item) => (
                  <InboxPhoneRow
                    key={item.id}
                    item={item}
                    businessName={businessName}
                    purpose={purpose}
                    vertical={vertical}
                    ret={ret}
                  />
                ))}
              </ul>
              <div className="mt-8 hidden lg:block">
                <DeskDataTable minWidthClass="min-w-0">
                  <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                    <tr>
                      {inboxTableKind(purpose) === "hold" ? (
                        <>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            <span className="flex items-center gap-3">
                              <InboxHeaderCheck />
                              Item
                            </span>
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            Who
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            Needed
                          </th>
                        </>
                      ) : null}
                      {inboxTableKind(purpose) === "job" ? (
                        <>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            <span className="flex items-center gap-3">
                              <InboxHeaderCheck />
                              {copy.jobColumn}
                            </span>
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            Who
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            Place
                          </th>
                        </>
                      ) : null}
                      {inboxTableKind(purpose) === "mixed" ? (
                        <>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            <span className="flex items-center gap-3">
                              <InboxHeaderCheck />
                              Work
                            </span>
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            Needed
                          </th>
                          <th scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                            When
                          </th>
                        </>
                      ) : null}
                      <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.14em]">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {showArchivedEntry ? (
                      <InboxArchivedTableRow count={counts.archived} ret={ret} />
                    ) : null}
                    {pageRows.map((item) => (
                      <InboxTableRow
                        key={item.id}
                        item={item}
                        businessName={businessName}
                        purpose={purpose}
                        vertical={vertical}
                        ret={ret}
                      />
                    ))}
                  </tbody>
                </DeskDataTable>
              </div>
            </DeskLandScope>
          </InboxPileSwipe>

          <Pagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            total={listed.length}
            href="/calls"
            params={{ ...viewParams, purpose, q: q || undefined }}
          />
        </>
      )}
    </>
  );
}
