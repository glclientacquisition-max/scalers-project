import Link from "next/link";
import { InboxToolbar } from "@/components/InboxToolbar";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import { loadInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";
import {
  countInboxPurposes,
  inboxCaption,
  itemMatchesPurpose,
  itemMatchesQuery,
  orderInboxItems,
  resolvePurposeFilter,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import { InboxPhoneRow } from "@/components/InboxItemRow";
import { inboxKeepHref, type InboxReturn } from "@/lib/inboxHref";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { VisitWeekCalendar } from "@/components/VisitWeekCalendar";
import { RunSheetToday } from "@/components/RunSheetToday";
import { visitBoardForDay, visitBoardItems } from "@/lib/runSheet";
import { holdBoardForDay } from "@/lib/holdSheet";
import {
  parseDayParam,
  parseWeekParam,
  shiftDayYmd,
  shiftWeekYmd,
} from "@/lib/visitCalendar";
import { btnGhost, btnPrimary, deskEmptyClass } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function EmptyInbox({
  total,
  pendingDid,
  did,
  purpose,
  q,
  vertical,
  openCallId,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
  purpose: InboxPurposeFilterId;
  q: string;
  vertical?: string | null;
  openCallId?: string;
}) {
  const copy = nicheCopy(vertical);
  if (q) {
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">No matches</p>
        <Link href={inboxKeepHref(openCallId, { purpose })} className={`${btnGhost} mt-6`}>
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
            : "Nothing in this filter";
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">{emptyLabel}</p>
        <Link href={inboxKeepHref(openCallId, { purpose: "all" })} className={`${btnGhost} mt-6`}>
          Show all
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-8 border-y border-accent/30 bg-accent/5 py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">Number being assigned</p>
        <Link href={businessSettingsHref("train")} className={`${btnPrimary} mt-6 px-5`}>
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

function rowIsOpen(item: { id: string; callId: string | null }, openCallId?: string) {
  if (!openCallId) return false;
  return item.callId === openCallId || item.id === openCallId;
}

export async function InboxWorkspace({
  searchParams,
  openCallId,
  pane,
}: {
  searchParams: {
    page?: string;
    status?: string;
    purpose?: string;
    from?: string;
    q?: string;
    view?: string;
    week?: string;
    day?: string;
  };
  openCallId?: string;
  pane?: boolean;
}) {
  const page = Math.max(1, Number.parseInt(searchParams.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(searchParams.q);
  const split = Boolean(pane);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const client = workspace.client;
  const businessName = tenant.business_name?.trim() || "us";
  const vertical = tenant.vertical;

  const { items: assembled, error, partialError } = await loadInboxItems(
    client,
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
  const activeFilter = resolvePurposeFilter(
    searchParams.purpose || searchParams.from,
    searchParams.status,
    counts.needs
  );
  const filtered = orderInboxItems(
    searched.filter((item) => itemMatchesPurpose(item, activeFilter)),
    activeFilter
  );
  const rawView = String(searchParams.view || "");
  const view = rawView === "work" ? "today" : rawView;
  const weekView = activeFilter === "job" && view === "week";
  const todayView = activeFilter === "job" && view === "today";
  const holdTodayView = activeFilter === "hold" && view === "today";
  const boardView = weekView || todayView;
  const monday = parseWeekParam(searchParams.week);
  const day = parseDayParam(searchParams.day);
  const boardItems = boardView ? visitBoardItems(searched) : filtered;
  const todayItems = todayView ? visitBoardForDay(searched, day) : [];
  const holdTodayItems = holdTodayView ? holdBoardForDay(searched, day) : [];
  const total = filtered.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = boardView || holdTodayView ? boardItems : filtered.slice(from, from + PAGE_SIZE);

  const keepRet = {
    purpose: activeFilter,
    q: q || undefined,
    view: weekView ? "week" : todayView || holdTodayView ? "today" : undefined,
    week: weekView ? monday : undefined,
    day: todayView || holdTodayView ? day : undefined,
  };
  const paginationParams: Record<string, string | undefined> = split
    ? {
        from: activeFilter,
        q: keepRet.q,
        view: keepRet.view,
        week: keepRet.week,
        day: keepRet.day,
      }
    : {
        purpose: activeFilter,
        q: keepRet.q,
        view: keepRet.view,
        week: keepRet.week,
        day: keepRet.day,
      };
  const inboxRet: InboxReturn = {
    purpose: activeFilter,
    q: q || undefined,
    page: boardView || holdTodayView ? undefined : page,
    view: boardView || holdTodayView ? view : undefined,
    week: weekView ? monday : undefined,
    day: todayView || holdTodayView ? day : undefined,
  };
  const keep = (ret: InboxReturn) => inboxKeepHref(openCallId, ret);

  return (
    <div
      className={
        split ? "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pt-4" : undefined
      }
    >
      <div className={split ? "min-w-0 shrink-0" : undefined}>
      <InboxToolbar
        active={activeFilter}
        counts={counts}
        q={q}
        caption={inboxCaption(searched, vertical)}
        vertical={vertical}
        view={boardView || holdTodayView ? view : undefined}
        week={weekView ? monday : undefined}
        day={todayView || holdTodayView ? day : undefined}
        openCallId={openCallId}
        pane={pane}
      />
      </div>

      <div
        className={
          split
            ? "mt-4 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            : undefined
        }
      >

      {partialError ? (
        <div className="mt-6">
          <DeskError>{partialError}</DeskError>
        </div>
      ) : null}

      {todayView ? (
        <RunSheetToday
          items={todayItems}
          ymd={day}
          prevHref={keep({
            purpose: "job",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, -1),
          })}
          nextHref={keep({
            purpose: "job",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, 1),
          })}
          listHref={keep({ purpose: "job", q: q || undefined })}
          ret={{ purpose: "job", q: q || undefined, view: "today", day }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : holdTodayView ? (
        <RunSheetToday
          items={holdTodayItems}
          ymd={day}
          purpose="hold"
          prevHref={keep({
            purpose: "hold",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, -1),
          })}
          nextHref={keep({
            purpose: "hold",
            q: q || undefined,
            view: "today",
            day: shiftDayYmd(day, 1),
          })}
          listHref={keep({ purpose: "hold", q: q || undefined })}
          ret={{ purpose: "hold", q: q || undefined, view: "today", day }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : weekView ? (
        <VisitWeekCalendar
          items={boardItems}
          monday={monday}
          prevHref={keep({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, -1),
          })}
          nextHref={keep({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, 1),
          })}
          listHref={keep({ purpose: "job", q: q || undefined })}
          ret={{ purpose: "job", q: q || undefined, view: "week", week: monday }}
          businessName={businessName}
          vertical={vertical}
        />
      ) : pageRows.length === 0 ? (
        <EmptyInbox
          total={total}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          purpose={activeFilter}
          q={q}
          vertical={vertical}
          openCallId={openCallId}
        />
      ) : (
        <>
          <DeskLandScope
            ids={pageRows.map((item) => item.id)}
            scopeKey={`${activeFilter}:${page}:${q}`}
          >
            <ul
              aria-label="Conversations"
              className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface"
            >
              {pageRows.map((item) => (
                <InboxPhoneRow
                  key={item.id}
                  item={item}
                  businessName={businessName}
                  purpose={activeFilter}
                  vertical={vertical}
                  ret={inboxRet}
                  current={rowIsOpen(item, openCallId)}
                />
              ))}
            </ul>
          </DeskLandScope>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href={openCallId ? `/calls/${openCallId}` : "/calls"}
            params={paginationParams}
          />
        </>
      )}
      </div>
    </div>
  );
}
