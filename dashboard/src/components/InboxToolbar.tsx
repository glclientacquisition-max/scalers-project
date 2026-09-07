"use client";

import Link from "next/link";
import { callsHref } from "@/lib/callsTriage";
import { nicheCopy, purposeFilters } from "@/lib/inboxNiche";
import type { InboxPurposeFilterId } from "@/lib/inboxPurpose";
import { settingsGhostButtonClass } from "@/components/settingsUi";

export function InboxToolbar({
  active,
  counts,
  q,
  caption,
  vertical,
}: {
  active: InboxPurposeFilterId;
  counts: Record<InboxPurposeFilterId, number>;
  q: string;
  caption?: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  const filters = purposeFilters(vertical);
  const briefing =
    caption ||
    (counts.needs > 0 ? `${counts.needs} need you` : "Clear");

  return (
    <header className="space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold leading-tight tracking-tight text-ink">
            Inbox
          </h1>
          <p className="mt-1 text-[13px] text-ink-soft">{briefing}</p>
        </div>
        <form
          action="/calls"
          method="get"
          className="flex w-full min-w-0 gap-2 sm:max-w-sm"
        >
          <input type="hidden" name="purpose" value={active} />
          <label className="sr-only" htmlFor="inbox-search">
            Search inbox
          </label>
          <input
            id="inbox-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={copy.searchPlaceholder}
            className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-white px-4 text-sm text-ink outline-none transition duration-150 placeholder:text-ink-soft/70 hover:border-[#0096FF]/40 focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]"
          />
          <button type="submit" className={settingsGhostButtonClass}>
            Search
          </button>
        </form>
      </div>

      <nav aria-label="Filter by purpose" className="border-b border-line">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          {filters.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <Link
                  href={callsHref({ purpose: item.id, q: q || undefined })}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "group inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2",
                    isActive
                      ? "border-[#0096FF] text-[#005ccc]"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink active:text-[#005ccc]",
                  ].join(" ")}
                >
                  {item.label}
                  <span
                    className={[
                      "rounded-md px-1.5 py-0.5 text-xs tabular-nums transition duration-150",
                      isActive
                        ? "bg-[#0096FF]/10 text-[#005ccc]"
                        : "bg-surface-muted text-ink-soft group-hover:bg-[#0096FF]/10 group-hover:text-ink",
                    ].join(" ")}
                  >
                    {counts[item.id]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {q ? (
        <p className="text-sm text-ink-soft">
          Matches for{" "}
          <span className="font-medium text-ink">&ldquo;{q}&rdquo;</span>.{" "}
          <Link
            href={callsHref({ purpose: active })}
            className="font-medium text-[#0096FF] transition duration-150 hover:text-[#005ccc] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
          >
            Clear
          </Link>
        </p>
      ) : null}
    </header>
  );
}
