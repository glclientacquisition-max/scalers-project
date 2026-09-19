import Link from "next/link";
import { deskShiftClass } from "@/components/ui/deskChrome";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  /** Base path without query, e.g. `/calls` */
  href: string;
  /** Extra query params to preserve (without page). */
  params?: Record<string, string | undefined>;
};

function buildHref(
  base: string,
  page: number,
  params?: Record<string, string | undefined>
): string {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) q.set(k, v);
    }
  }
  if (page > 1) q.set("page", String(page));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

function pagerControlClass(enabled: boolean) {
  return enabled
    ? "inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    : "inline-flex min-h-11 items-center rounded-lg border border-line/50 px-3 text-sm text-ink-soft opacity-50";
}

/** Server-friendly previous/next pager for list pages. */
export function Pagination({ page, pageSize, total, href, params }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return (
      <p className="mt-4 text-sm text-ink-soft">
        {total} {total === 1 ? "item" : "items"}
      </p>
    );
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const jumpId = `page-jump-${href.replace(/\W/g, "") || "list"}`;

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
      <p className="text-sm text-ink-soft">
        {from}-{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={buildHref(href, page - 1, params)} className={pagerControlClass(true)}>
            Previous
          </Link>
        ) : (
          <span className={pagerControlClass(false)}>Previous</span>
        )}
        {totalPages > 5 ? (
          <form action={href} method="get" className="flex items-center gap-2">
            {params
              ? Object.entries(params).map(([key, value]) =>
                  value ? <input key={key} type="hidden" name={key} value={value} /> : null
                )
              : null}
            <label className="sr-only" htmlFor={jumpId}>
              Page
            </label>
            <input
              id={jumpId}
              name="page"
              type="number"
              min={1}
              max={totalPages}
              defaultValue={page}
              className={`h-11 w-14 rounded-lg border border-line bg-surface px-2 text-center text-sm tabular-nums text-ink-soft ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
            />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Go
            </button>
          </form>
        ) : (
          <span className="px-1 text-sm text-ink-soft">
            {page} / {totalPages}
          </span>
        )}
        {page < totalPages ? (
          <Link href={buildHref(href, page + 1, params)} className={pagerControlClass(true)}>
            Next
          </Link>
        ) : (
          <span className={pagerControlClass(false)}>Next</span>
        )}
      </div>
    </div>
  );
}

export const DEFAULT_PAGE_SIZE = 25;
