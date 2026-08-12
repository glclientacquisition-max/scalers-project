import Link from "next/link";
import {
  callsHref,
  STATUS_FILTERS,
  type StatusFilterId,
} from "@/lib/callsTriage";

export function CallsToolbar({
  active,
  counts,
  q,
}: {
  active: StatusFilterId;
  counts: {
    all: number;
    new: number;
    contacted: number;
    resolved: number;
    archived: number;
  };
  q: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
          Inbox
        </h1>
        <form
          action="/calls"
          method="get"
          className="flex min-w-[min(100%,18rem)] flex-1 justify-end gap-2 sm:max-w-xs"
        >
          <input type="hidden" name="status" value={active} />
          <label className="sr-only" htmlFor="calls-search">
            Search callers
          </label>
          <input
            id="calls-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search name, number, reason"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[#0096FF] focus-visible:shadow-focus"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
          >
            Search
          </button>
        </form>
      </div>

      <nav aria-label="Filter by follow-up status" className="mt-6 border-b border-line">
        <ul className="flex gap-1 overflow-x-auto">
          {STATUS_FILTERS.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id}>
                <Link
                  href={callsHref({ status: item.id, q: q || undefined })}
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                    isActive
                      ? "border-[#0096FF] text-[#005ccc]"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                  <span
                    className={[
                      "tabular-nums text-xs",
                      isActive ? "text-[#005ccc]" : "text-ink-soft",
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
        <p className="mt-3 text-sm text-ink-soft">
          Showing matches for{" "}
          <span className="font-medium text-ink">&ldquo;{q}&rdquo;</span>.{" "}
          <Link
            href={callsHref({ status: active })}
            className="font-medium text-[#005ccc] hover:underline"
          >
            Clear search
          </Link>
        </p>
      ) : null}
    </div>
  );
}
