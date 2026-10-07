"use client";

import { callsHref } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import { inboxPileHref } from "@/lib/inboxSwipe";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import { useInboxPileNav } from "@/components/InboxPileNav";
import {
  deskFieldClass,
  deskListTitleClass,
  pageTitleClass,
} from "@/components/ui/deskChrome";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { Segmented } from "@/components/ui/Segmented";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { DeskBack, DeskRecordLead } from "@/components/ui/DeskBack";

export function InboxToolbar({
  active,
  counts,
  q,
  vertical,
  view,
  week,
  day,
  backHref,
  from,
  rpage,
}: {
  active: InboxPurposeFilterId;
  counts: Record<InboxPurposeFilterId, number>;
  q: string;
  vertical?: string | null;
  view?: string;
  week?: string;
  day?: string;
  backHref?: string;
  from?: string;
  rpage?: string;
}) {
  const nav = useInboxPileNav();
  const current = nav?.purpose ?? active;
  const query = nav?.q ?? q;
  const chipCounts = nav?.counts ?? counts;
  const copy = nicheCopy(vertical);
  const filters = purposeFilters(vertical);
  const archived = current === "archived";
  const weekView = current === "job" && view === "week";
  const todayView = current === "job" && (view === "today" || view === "work");
  const holdToday = current === "hold" && (view === "today" || view === "work");
  const workView = weekView || todayView;

  const searchForm = (
    <form
      action="/calls"
      method="get"
      className="w-full min-w-0"
    >
      <input type="hidden" name="purpose" value={current} />
      {archived && from ? <input type="hidden" name="from" value={from} /> : null}
      {archived && rpage ? <input type="hidden" name="rpage" value={rpage} /> : null}
      {archived && view ? <input type="hidden" name="view" value={view} /> : null}
      {archived && week ? <input type="hidden" name="week" value={week} /> : null}
      {archived && day ? <input type="hidden" name="day" value={day} /> : null}
      {workView || holdToday ? (
        <input type="hidden" name="view" value={weekView ? "week" : "today"} />
      ) : null}
      {weekView && week ? <input type="hidden" name="week" value={week} /> : null}
      {(todayView || holdToday) && day ? <input type="hidden" name="day" value={day} /> : null}
      <label className="sr-only" htmlFor="inbox-search">
        Search inbox
      </label>
      <input
        id="inbox-search"
        name="q"
        type="search"
        value={query}
        placeholder={copy.searchPlaceholder}
        className={deskFieldClass}
        onChange={(event) => nav?.setQuery(event.currentTarget.value)}
      />
    </form>
  );

  return (
    <header className="space-y-3">
      {archived ? (
        <DeskIndexLead
          status={
            <DeskRecordLead
              align="center"
              back={<DeskBack href={backHref || callsHref({ q: query || undefined })}>Inbox</DeskBack>}
            >
              <h1 className={pageTitleClass}>Archived</h1>
            </DeskRecordLead>
          }
        >
          {searchForm}
        </DeskIndexLead>
      ) : (
        <>
          <h1 className={deskListTitleClass}>Inbox</h1>
          <DeskIndexLead>
            {searchForm}
          </DeskIndexLead>
        </>
      )}

      {archived ? null : (
      <InboxFilterPills
        label="Filter by purpose"
        active={current}
        items={filters.map((item) => ({
          id: item.id,
          label: item.label,
          count: chipCounts[item.id],
          href: inboxPileHref(item.id, {
            q: query,
            active: current,
            view,
            week,
            day,
          }),
        }))}
      />
      )}

      {current === "job" ? (
        <Segmented
          label="Visit sort"
          items={[
            {
              key: "list",
              label: "List",
              href: callsHref({ purpose: "job", q: query || undefined }),
              active: !workView,
            },
            {
              key: "work",
              label: "Work",
              href: callsHref({
                purpose: "job",
                q: query || undefined,
                view: weekView ? "week" : "today",
                week: weekView ? week : undefined,
                day: weekView ? undefined : day,
              }),
              active: workView,
            },
          ]}
        />
      ) : null}

      {current === "hold" ? (
        <Segmented
          label="Hold sort"
          items={[
            {
              key: "list",
              label: "List",
              href: callsHref({ purpose: "hold", q: query || undefined }),
              active: !holdToday,
            },
            {
              key: "work",
              label: "Work",
              href: callsHref({
                purpose: "hold",
                q: query || undefined,
                view: "today",
                day,
              }),
              active: holdToday,
            },
          ]}
        />
      ) : null}

      {current === "job" && workView ? (
        <Segmented
          label="Work date"
          items={[
            {
              key: "today",
              label: "Today",
              href: callsHref({
                purpose: "job",
                q: query || undefined,
                view: "today",
                day,
              }),
              active: !weekView,
            },
            {
              key: "week",
              label: "Week",
              href: callsHref({
                purpose: "job",
                q: query || undefined,
                view: "week",
                week,
              }),
              active: weekView,
            },
          ]}
        />
      ) : null}
    </header>
  );
}
