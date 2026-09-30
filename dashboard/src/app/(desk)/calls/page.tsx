import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { InboxToolbar } from "@/components/InboxToolbar";
import { callsHref, sanitizeSearchQuery } from "@/lib/callsTriage";
import { loadCachedInboxItems } from "@/lib/inboxLoad";
import {
  countInboxPurposes,
  itemMatchesQuery,
  resolvePurposeFilter,
} from "@/lib/inboxPurpose";
import {
  inboxReturnFromSearch,
  inboxReturnHref,
  type InboxReturn,
} from "@/lib/inboxHref";
import { inboxTeammateOptions } from "@/lib/inboxTriage";
import { InboxRowUiProvider } from "@/components/InboxRowUi";
import {
  InboxPileNavProvider,
  InboxPileSelectChrome,
} from "@/components/InboxPileNav";
import { InboxPileBoard } from "@/components/InboxPileBoard";
import { inboxPileHref } from "@/lib/inboxSwipe";
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
import { purposeFilters, purposeForPack } from "@/lib/inboxNiche";
import { DeskError } from "@/components/ui/DeskError";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { createDeskTimer } from "@/lib/deskTiming";
import { DeskPageGate } from "@/components/DeskPageGate";

type CallsPageProps = {
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
};

export default function CallsPage(props: CallsPageProps) {
  return (
    <DeskPageGate>
      <CallsBody {...props} />
    </DeskPageGate>
  );
}

async function CallsBody({ searchParams }: CallsPageProps) {
  const timer = createDeskTimer();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(sp.q);

  const tenant = await getCurrentTenant();
  timer.mark("tenant");
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const businessName = tenant.business_name?.trim() || "us";
  const vertical = tenant.vertical;

  const { items: assembled, error, partialError } = await loadCachedInboxItems(
    tenant.id,
    vertical
  );
  timer.mark("data");
  console.info(timer.line("inbox"));

  if (error) {
    return <DeskLoadError>Could not load inbox.</DeskLoadError>;
  }

  const searched = q
    ? assembled.filter((item) => itemMatchesQuery(item, q))
    : assembled;
  const counts = countInboxPurposes(searched);
  const resolvedFilter = resolvePurposeFilter(sp.purpose, sp.status, counts.needs);
  const activeFilter = purposeForPack(resolvedFilter, vertical, counts.needs);
  const rawView = String(sp.view || "");
  const view = rawView === "work" ? "today" : rawView;
  const weekView = activeFilter === "job" && view === "week";
  const todayView = activeFilter === "job" && view === "today";
  const holdTodayView = activeFilter === "hold" && view === "today";
  const boardView = weekView || todayView;
  const monday = parseWeekParam(sp.week);
  const day = parseDayParam(sp.day);

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
    purposeFilters(vertical).map((row) => {
      const id = row.id;
      return [id, inboxPileHref(id, pileHrefOpts)];
    })
  );

  return (
    <InboxRowUiProvider teammates={inboxTeammateOptions(tenant.team_directory)}>
    <InboxPileNavProvider
      purpose={activeFilter}
      items={assembled}
      q={q}
      hrefs={pileHrefs}
      view={pileHrefOpts.view}
      week={pileHrefOpts.week}
      day={pileHrefOpts.day}
      from={archivedReturn?.purpose}
      rpage={
        archivedReturn?.page != null ? String(archivedReturn.page) : undefined
      }
      enableSelect={!boardView && !holdTodayView}
    >
    <div>
      <InboxPileSelectChrome>
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
      </InboxPileSelectChrome>

      {partialError ? (
        <div className="mt-6">
          <DeskLoadError>{partialError}</DeskLoadError>
        </div>
      ) : null}

      {todayView ? (
        <RunSheetToday
          items={visitBoardForDay(assembled, day)}
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
          items={holdBoardForDay(assembled, day)}
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
          items={visitBoardItems(assembled)}
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
      ) : (
        <InboxPileBoard
          assembledCount={assembled.length}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          q={q}
          vertical={vertical}
          businessName={businessName}
          counts={counts}
          inboxRet={inboxRet}
          hrefs={pileHrefs}
        />
      )}
    </div>
    </InboxPileNavProvider>
    </InboxRowUiProvider>
  );
}
