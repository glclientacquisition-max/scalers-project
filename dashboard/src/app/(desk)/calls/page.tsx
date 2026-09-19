import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { InboxToolbar } from "@/components/InboxToolbar";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { callsHref, sanitizeSearchQuery } from "@/lib/callsTriage";
import { loadCachedInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";
import {
  countInboxPurposes,
  itemMatchesPurpose,
  itemMatchesQuery,
  orderInboxItems,
  resolvePurposeFilter,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import {
  InboxPhoneRow,
  InboxTableRow,
  inboxTableKind,
} from "@/components/InboxItemRow";
import { InboxArchivedPhoneRow, InboxArchivedTableRow } from "@/components/InboxArchivedRow";
import {
  inboxReturnFromSearch,
  inboxReturnHref,
  type InboxReturn,
} from "@/lib/inboxHref";
import { inboxTeammateOptions } from "@/lib/inboxTriage";
import { InboxRowUiProvider } from "@/components/InboxRowUi";
import { InboxSelectChrome } from "@/components/InboxRowSelect";
import { InboxPileSwipe } from "@/components/InboxPileSwipe";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { inboxPileHref, SWIPE_PILES } from "@/lib/inboxSwipe";
import { VisitWeekCalendar } from "@/components/VisitWeekCalendar";
import { RunSheetToday } from "@/components/RunSheetToday";
import { visitBoardForDay, visitBoardItems, orderVisitList } from "@/lib/runSheet";
import { holdBoardForDay, orderHoldList } from "@/lib/holdSheet";
import {
  parseDayParam,
  parseWeekParam,
  shiftDayYmd,
  shiftWeekYmd,
} from "@/lib/visitCalendar";
import { btnGhost, btnPrimary, deskEmptyClass } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

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
  const copy = nicheCopy(vertical);
  if (q) {
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">No matches</p>
        <Link
          href={callsHref({ purpose })}
          className={`${btnGhost} mt-6`}
        >
          Clear search
        </Link>
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


export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    purpose?: string;
    q?: string;
    view?: string;
    week?: string;
    day?: string;
    from?: string;
    rpage?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(sp.q);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const businessName = tenant.business_name?.trim() || "us";
  const vertical = tenant.vertical;
  const copy = nicheCopy(vertical);

  const { items: assembled, error, partialError } = await loadCachedInboxItems(
    tenant.id,
    vertical
  );

  if (error) {
    return <DeskError>Could not load inbox.</DeskError>;
  }

  const searched = q
    ? assembled.filter((item) => itemMatchesQuery(item, q))
    : assembled;
  const counts = countInboxPurposes(searched);
  const activeFilter = resolvePurposeFilter(sp.purpose, sp.status, counts.needs);
  const filtered = orderInboxItems(
    searched.filter((item) => itemMatchesPurpose(item, activeFilter)),
    activeFilter
  );
  const listed =
    activeFilter === "job"
      ? orderVisitList(filtered)
      : activeFilter === "hold"
        ? orderHoldList(filtered)
        : filtered;
  const rawView = String(sp.view || "");
  const view = rawView === "work" ? "today" : rawView;
  const weekView = activeFilter === "job" && view === "week";
  const todayView = activeFilter === "job" && view === "today";
  const holdTodayView = activeFilter === "hold" && view === "today";
  const boardView = weekView || todayView;
  const monday = parseWeekParam(sp.week);
  const day = parseDayParam(sp.day);
  const boardItems = boardView ? visitBoardItems(searched) : filtered;
  const todayItems = todayView ? visitBoardForDay(searched, day) : [];
  const holdTodayItems = holdTodayView ? holdBoardForDay(searched, day) : [];
  const total = filtered.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = boardView || holdTodayView ? boardItems : listed.slice(from, from + PAGE_SIZE);
  const showArchivedEntry =
    !boardView &&
    !holdTodayView &&
    activeFilter !== "archived" &&
    counts.archived > 0 &&
    page === 1;

  const paginationParams: Record<string, string | undefined> = {
    purpose: activeFilter,
    q: q || undefined,
    view: weekView ? "week" : todayView || holdTodayView ? "today" : undefined,
    week: weekView ? monday : undefined,
    day: todayView || holdTodayView ? day : undefined,
  };
  const inboxRet: InboxReturn = {
    purpose: activeFilter,
    q: q || undefined,
    page: boardView || holdTodayView ? undefined : page,
    view: boardView || holdTodayView ? view : undefined,
    week: weekView ? monday : undefined,
    day: todayView || holdTodayView ? day : undefined,
  };
  const archivedReturn =
    activeFilter === "archived"
      ? inboxReturnFromSearch({
          from: sp.from,
          view: sp.view,
          week: sp.week,
          day: sp.day,
          q: sp.q,
          page: sp.rpage,
        })
      : null;
  const archivedBackHref = archivedReturn ? inboxReturnHref(archivedReturn) : undefined;
  const pileHrefOpts = {
    q,
    active: activeFilter,
    view: boardView || holdTodayView ? view : archivedReturn?.view,
    week: weekView ? monday : archivedReturn?.week,
    day: todayView || holdTodayView ? day : archivedReturn?.day,
  };
  const pileHrefs = Object.fromEntries(
    SWIPE_PILES.map((id) => [id, inboxPileHref(id, pileHrefOpts)])
  );

  return (
    <InboxRowUiProvider teammates={inboxTeammateOptions(tenant.team_directory)}>
    <div>
      <InboxSelectChrome items={boardView || holdTodayView ? [] : pageRows}>
      <InboxToolbar
        active={activeFilter}
        counts={counts}
        q={q}
        vertical={vertical}
        view={boardView || holdTodayView ? view : archivedReturn?.view}
        week={weekView ? monday : archivedReturn?.week}
        day={todayView || holdTodayView ? day : archivedReturn?.day}
        backHref={archivedBackHref}
        from={archivedReturn?.purpose}
        rpage={
          archivedReturn?.page != null ? String(archivedReturn.page) : undefined
        }
      />
      </InboxSelectChrome>

      {partialError ? (
        <div className="mt-6">
          <DeskError>{partialError}</DeskError>
        </div>
      ) : null}

      {todayView ? (
        <RunSheetToday
          items={todayItems}
          ymd={day}
          prevHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, -1),
          })}
          nextHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, 1),
          })}
          listHref={callsHref({ purpose: "job", q: q || undefined })}
          ret={{ purpose: "job", q: q || undefined, view: "today", day }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : holdTodayView ? (
        <RunSheetToday
          items={holdTodayItems}
          ymd={day}
          purpose="hold"
          prevHref={callsHref({
            purpose: "hold",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, -1),
          })}
          nextHref={callsHref({
            purpose: "hold",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, 1),
          })}
          listHref={callsHref({ purpose: "hold", q: q || undefined })}
          ret={{ purpose: "hold", q: q || undefined, view: "today", day }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : weekView ? (
        <VisitWeekCalendar
          items={boardItems}
          monday={monday}
          prevHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, -1),
          })}
          nextHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, 1),
          })}
          listHref={callsHref({ purpose: "job", q: q || undefined })}
          ret={{ purpose: "job", q: q || undefined, view: "week", week: monday }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : pageRows.length === 0 && !showArchivedEntry ? (
        <InboxPileSwipe
          active={activeFilter}
          hrefs={pileHrefs}
          enabled={activeFilter !== "archived"}
        >
        <EmptyInbox
          total={assembled.length}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          purpose={activeFilter}
          q={q}
          vertical={vertical}
        />
        </InboxPileSwipe>
      ) : (
        <>
          <InboxPileSwipe
            active={activeFilter}
            hrefs={pileHrefs}
            enabled={activeFilter !== "archived"}
          >
          <DeskLandScope
            ids={pageRows.map((item) => item.id)}
            scopeKey={`${activeFilter}:${page}:${q}`}
          >
          <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface lg:hidden">
            {showArchivedEntry ? <InboxArchivedPhoneRow count={counts.archived} ret={inboxRet} /> : null}
            {pageRows.map((item) => (
              <InboxPhoneRow
                key={item.id}
                item={item}
                businessName={businessName}
                purpose={activeFilter}
                vertical={vertical}
                ret={inboxRet}
              />
            ))}
          </ul>
          <div className="mt-8 hidden lg:block">
            <DeskDataTable minWidthClass="min-w-0">
              <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                <tr>
                  {inboxTableKind(activeFilter) === "hold" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Item
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Who
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Needed
                      </th>
                    </>
                  ) : null}
                  {inboxTableKind(activeFilter) === "job" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        {copy.jobColumn}
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Who
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Place
                      </th>
                    </>
                  ) : null}
                  {inboxTableKind(activeFilter) === "mixed" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Work
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Needed
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        When
                      </th>
                    </>
                  ) : null}
                  <th scope="col" className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.14em]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {showArchivedEntry ? <InboxArchivedTableRow count={counts.archived} ret={inboxRet} /> : null}
                {pageRows.map((item) => (
                  <InboxTableRow
                    key={item.id}
                    item={item}
                    businessName={businessName}
                    purpose={activeFilter}
                    vertical={vertical}
                    ret={inboxRet}
                  />
                ))}
              </tbody>
            </DeskDataTable>
          </div>
          </DeskLandScope>
          </InboxPileSwipe>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href="/calls"
            params={paginationParams}
          />
        </>
      )}
    </div>
    </InboxRowUiProvider>
  );
}
