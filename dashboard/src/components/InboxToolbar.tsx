"use client";

import Link from "next/link";
import { callsHref } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import { btnGhost, deskFieldClass, deskPreviewClass, deskShiftClass, pageTitleClass } from "@/components/ui/deskChrome";
import { FilterTabs } from "@/components/ui/FilterTabs";

export function InboxToolbar({
  active,
  counts,
  q,
  caption,
  vertical,
  view,
}: {
  active: InboxPurposeFilterId;
  counts: Record<InboxPurposeFilterId, number>;
  q: string;
  caption?: string;
  vertical?: string | null;
  view?: string;
}) {
  const copy = nicheCopy(vertical);
  const filters = purposeFilters(vertical);
  const briefing =
    caption ||
    (counts.needs > 0 ? `${counts.needs} need you` : "Clear");
  const weekView = active === "job" && view === "week";
  const todayView = active === "job" && view === "today";
  const dateFilter = weekView || todayView;

  return (
    <header className="space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className={pageTitleClass}>Inbox</h1>
          <p className={`mt-1 text-[13px] text-ink-soft ${deskPreviewClass}`}>{briefing}</p>
        </div>
        <form
          action="/calls"
          method="get"
          className="flex w-full min-w-0 gap-2 sm:max-w-sm"
        >
          <input type="hidden" name="purpose" value={active} />
          {dateFilter ? <input type="hidden" name="view" value={view} /> : null}
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
          />
          <button type="submit" className={btnGhost}>
            Search
          </button>
        </form>
      </div>

      <FilterTabs
        label="Filter by purpose"
        active={active}
        items={filters.map((item) => ({
          id: item.id,
          label: item.label,
          count: counts[item.id],
          divide: item.divide,
          href: callsHref({
            purpose: item.id,
            q: q || undefined,
            view: item.id === "job" && dateFilter ? view : undefined,
          }),
        }))}
      />

      {active === "job" ? (
        <FilterTabs
          label="Visit filter"
          active={weekView ? "week" : todayView ? "today" : "list"}
          items={[
            {
              id: "list",
              label: "List",
              href: callsHref({ purpose: "job", q: q || undefined }),
            },
            {
              id: "today",
              label: "Today",
              href: callsHref({
                purpose: "job",
                q: q || undefined,
                view: "today",
              }),
            },
            {
              id: "week",
              label: "Week",
              href: callsHref({
                purpose: "job",
                q: q || undefined,
                view: "week",
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
            href={callsHref({ purpose: active })}
            className={`font-medium text-accent-deep ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            Clear
          </Link>
        </p>
      ) : null}
    </header>
  );
}
