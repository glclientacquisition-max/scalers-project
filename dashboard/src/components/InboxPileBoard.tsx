"use client";

import { useRef } from "react";
import { EndlessSentinel } from "@/components/EndlessList";
import { PullRefreshMark, pullRootVisible, usePhoneListPull, usePhoneTabRefresh } from "@/components/PhonePullRefresh";
import { DeskError } from "@/components/ui/DeskError";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { inboxPhoneWindowClass, listWindowClass } from "@/lib/endlessList";
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
import { Empty } from "@/components/ui/Empty";
import { Button, ButtonLink } from "@/components/ui/Button";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";

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
        className="h-6 w-6 shrink-0 accent-accent focus:outline-none focus:ring-2 focus:ring-brand"
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
      <Empty
        title="No matches"
        action={
          nav ? (
            <Button type="button" variant="ghost" onClick={() => nav.setQuery("")}>
              Clear
            </Button>
          ) : (
            <ButtonLink href={callsHref({ purpose })} variant="ghost">
              Clear
            </ButtonLink>
          )
        }
      />
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
      <Empty
        title={emptyLabel}
        action={
          <ButtonLink href={callsHref({ purpose: "all" })} variant="ghost">
            Show all
          </ButtonLink>
        }
      />
    );
  }

  if (pendingDid) {
    return (
      <Empty
        title="Number being assigned"
        line="Train the line while the number lands."
        action={
          <ButtonLink href={businessSettingsHref("train")} variant="primary">
            Train
          </ButtonLink>
        }
      />
    );
  }

  return (
    <Empty
      title="Inbox is empty"
      line="Calls land here."
      action={
        did ? (
          <ButtonLink href={`tel:${did}`} variant="ghost">
            {did}
          </ButtonLink>
        ) : (
          <ButtonLink href={businessSettingsHref("test")} variant="ghost">
            Test line
          </ButtonLink>
        )
      }
    />
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
  hrefs: Partial<Record<string, string>>;
}) {
  const nav = useInboxPileNav();
  const pullRef = useRef<HTMLDivElement>(null);
  const pulling = usePhoneListPull(pullRef, () => nav?.refreshFirst());
  usePhoneTabRefresh(() => nav?.refreshFirst(), () => pullRootVisible(pullRef.current));
  const purpose = nav?.purpose ?? "all";
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
    <div ref={pullRef} data-pull-root="" className="min-w-0">
      {nav?.refreshError ? (
        <div className="mt-4">
          <DeskError>{nav.refreshError}</DeskError>
        </div>
      ) : null}
      <PullRefreshMark show={pulling || Boolean(nav?.refreshing)} />
      {paint === "pending" ? (
        <InboxPileSwipe
          active={purpose}
          hrefs={pileHrefs}
          enabled={purpose !== "archived"}
        >
          <div className="flex items-center justify-center py-12">
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
              <ul className={`mt-8 list-none overflow-hidden rounded-2xl border border-line bg-surface lg:hidden ${inboxPhoneWindowClass}`}>
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
                  <tbody className={listWindowClass}>
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

          <EndlessSentinel
            hasMore={nav?.hasMore ?? false}
            loading={false}
            loaded={pageRows.length}
            onLoad={nav?.loadMore || (() => {})}
          />
        </>
      )}
    </div>
  );
}
