"use client";

import Link from "next/link";
import { useRef } from "react";
import { callsHref } from "@/lib/callsTriage";
import { inboxArchivedHref } from "@/lib/inboxHref";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import {
  formatAttentionCount,
  formatAttentionCountAriaLabel,
} from "@/lib/deskAttentionCount";
import {
  btnGhost,
  deskFieldClass,
  deskShiftClass,
  deskStatusChipClass,
  pageTitleClass,
} from "@/components/ui/deskChrome";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { DeskBack } from "@/components/ui/DeskBack";

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
  const copy = nicheCopy(vertical);
  const filters = purposeFilters(vertical);
  const archived = active === "archived";
  const weekView = active === "job" && view === "week";
  const todayView = active === "job" && (view === "today" || view === "work");
  const holdToday = active === "hold" && (view === "today" || view === "work");
  const workView = weekView || todayView;
  const searchWait = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsDisplay = formatAttentionCount(counts.needs);
  const needsAria = formatAttentionCountAriaLabel(counts.needs);

  const searchForm = (
    <form
      action="/calls"
      method="get"
      className="flex w-full min-w-0 gap-2"
    >
      <input type="hidden" name="purpose" value={active} />
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
        defaultValue={q}
        placeholder={copy.searchPlaceholder}
        className={deskFieldClass}
        onChange={(event) => {
          const form = event.currentTarget.form;
          if (searchWait.current) clearTimeout(searchWait.current);
          searchWait.current = setTimeout(() => form?.requestSubmit(), 300);
        }}
      />
      <button type="submit" className={btnGhost}>
        Search
      </button>
    </form>
  );

  const statusChip =
    needsDisplay && needsAria ? (
      active === "needs" ? (
        <span className={deskStatusChipClass} aria-label={needsAria}>
          {needsDisplay}
        </span>
      ) : (
        <Link
          href={callsHref({ purpose: "needs", q: q || undefined })}
          className={deskStatusChipClass}
          aria-label={needsAria}
        >
          {needsDisplay}
        </Link>
      )
    ) : null;

  return (
    <header className="space-y-3">
      {archived ? <DeskBack href={backHref || callsHref({ q: q || undefined })}>Inbox</DeskBack> : null}
      {archived ? (
        <DeskIndexLead status={<h1 className={pageTitleClass}>Archived</h1>}>
          {searchForm}
        </DeskIndexLead>
      ) : (
        <DeskIndexLead status={statusChip}>{searchForm}</DeskIndexLead>
      )}

      {archived ? null : (
      <InboxFilterPills
        label="Filter by purpose"
        active={active}
        items={filters.map((item) => ({
          id: item.id,
          label: item.label,
          count: counts[item.id],
          href: callsHref({
            purpose: item.id,
            q: q || undefined,
            view:
              item.id === "job" && workView
                ? weekView
                  ? "week"
                  : "today"
                : item.id === "hold" && holdToday
                  ? "today"
                  : undefined,
            week: item.id === "job" && weekView ? week : undefined,
            day:
              (item.id === "job" && todayView) || (item.id === "hold" && holdToday)
                ? day
                : undefined,
          }),
        }))}
      />
      )}

      {active === "job" ? (
        <FilterTabs
          label="Visit sort"
          active={workView ? "work" : "list"}
          items={[
            {
              id: "list",
              label: "List",
              href: callsHref({ purpose: "job", q: q || undefined }),
            },
            {
              id: "work",
              label: "Work",
              href: callsHref({
                purpose: "job",
                q: q || undefined,
                view: weekView ? "week" : "today",
                week: weekView ? week : undefined,
                day: weekView ? undefined : day,
              }),
            },
          ]}
        />
      ) : null}

      {active === "hold" ? (
        <FilterTabs
          label="Hold sort"
          active={holdToday ? "work" : "list"}
          items={[
            {
              id: "list",
              label: "List",
              href: callsHref({ purpose: "hold", q: q || undefined }),
            },
            {
              id: "work",
              label: "Work",
              href: callsHref({
                purpose: "hold",
                q: q || undefined,
                view: "today",
                day,
              }),
            },
          ]}
        />
      ) : null}

      {active === "job" && workView ? (
        <FilterTabs
          label="Work date"
          active={weekView ? "week" : "today"}
          items={[
            {
              id: "today",
              label: "Today",
              href: callsHref({
                purpose: "job",
                q: q || undefined,
                view: "today",
                day,
              }),
            },
            {
              id: "week",
              label: "Week",
              href: callsHref({
                purpose: "job",
                q: q || undefined,
                view: "week",
                week,
              }),
            },
          ]}
        />
      ) : null}

      {q ? (
        <p className="text-sm text-ink-soft">
          Matches for{" "}
          <span className="font-medium text-ink">&ldquo;{q}&rdquo;</span>.{" "}
          <Link
            href={
              archived
                ? inboxArchivedHref({
                    purpose: from,
                    view,
                    week,
                    day,
                    page: rpage,
                  })
                : callsHref({ purpose: active })
            }
            className={`font-medium text-accent-deep ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            Clear
          </Link>
        </p>
      ) : null}
    </header>
  );
}
