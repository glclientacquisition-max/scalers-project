"use client";

import Link from "next/link";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import { inboxKeepHref } from "@/lib/inboxHref";
import { btnGhost, deskFieldClass, deskPreviewClass, deskShiftClass, pageTitleClass } from "@/components/ui/deskChrome";
import { FilterTabs } from "@/components/ui/FilterTabs";

export function InboxToolbar({
  active,
  counts,
  q,
  caption,
  vertical,
  view,
  week,
  day,
  openCallId,
  pane,
}: {
  active: InboxPurposeFilterId;
  counts: Record<InboxPurposeFilterId, number>;
  q: string;
  caption?: string;
  vertical?: string | null;
  view?: string;
  week?: string;
  day?: string;
  openCallId?: string;
  pane?: boolean;
}) {
  const copy = nicheCopy(vertical);
  const filters = purposeFilters(vertical);
  const briefing =
    caption ||
    (counts.needs > 0 ? `${counts.needs} need you` : "Clear");
  const weekView = active === "job" && view === "week";
  const todayView = active === "job" && (view === "today" || view === "work");
  const holdToday = active === "hold" && (view === "today" || view === "work");
  const workView = weekView || todayView;
  const keep = (ret: {
    purpose?: string;
    q?: string;
    view?: string;
    week?: string;
    day?: string;
  }) => inboxKeepHref(openCallId, ret);

  return (
    <header className="min-w-0 space-y-4">
      <div
        className={
          pane
            ? "flex min-w-0 flex-col gap-3"
            : "flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        }
      >
        <div className="min-w-0">
          <h1 className={pane ? "font-display text-2xl font-semibold tracking-tight text-ink" : pageTitleClass}>
            Inbox
          </h1>
          <p className={`mt-1 text-[13px] leading-5 text-ink-soft ${pane ? "" : deskPreviewClass}`}>
            {briefing}
          </p>
        </div>
        <form
          action={openCallId ? `/calls/${openCallId}` : "/calls"}
          method="get"
          className="flex w-full min-w-0 gap-2 sm:max-w-sm"
        >
          <input type="hidden" name={openCallId ? "from" : "purpose"} value={active} />
          {workView || holdToday ? (
            <input type="hidden" name="view" value={weekView ? "week" : "today"} />
          ) : null}
          {weekView && week ? <input type="hidden" name="week" value={week} /> : null}
          {(todayView || holdToday) && day ? <input type="hidden" name="day" value={day} /> : null}
          <label className="sr-only" htmlFor={pane ? "inbox-search-pane" : "inbox-search"}>
            Search inbox
          </label>
          <div className="min-w-0 flex-1">
            <input
              id={pane ? "inbox-search-pane" : "inbox-search"}
              name="q"
              type="search"
              defaultValue={q}
              placeholder={copy.searchPlaceholder}
              className={deskFieldClass}
            />
          </div>
          <button type="submit" className={`${btnGhost} shrink-0`}>
            Search
          </button>
        </form>
      </div>

      <FilterTabs
        label="Filter by purpose"
        active={active}
        wrap={Boolean(pane)}
        items={filters.map((item) => ({
          id: item.id,
          label: item.label,
          count: counts[item.id],
          divide: item.divide,
          href: keep({
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

      {active === "job" ? (
        <FilterTabs
          label="Visit sort"
          active={workView ? "work" : "list"}
          wrap={Boolean(pane)}
          items={[
            {
              id: "list",
              label: "List",
              href: keep({ purpose: "job", q: q || undefined }),
            },
            {
              id: "work",
              label: "Work",
              href: keep({
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
          wrap={Boolean(pane)}
          items={[
            {
              id: "list",
              label: "List",
              href: keep({ purpose: "hold", q: q || undefined }),
            },
            {
              id: "work",
              label: "Work",
              href: keep({
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
          wrap={Boolean(pane)}
          items={[
            {
              id: "today",
              label: "Today",
              href: keep({
                purpose: "job",
                q: q || undefined,
                view: "today",
                day,
              }),
            },
            {
              id: "week",
              label: "Week",
              href: keep({
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
            href={keep({ purpose: active })}
            className={`font-medium text-accent-deep ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            Clear
          </Link>
        </p>
      ) : null}
    </header>
  );
}
