import Link from "next/link";

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

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
      <p className="text-sm text-ink-soft">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(href, page - 1, params)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-accent"
          >
            Previous
          </Link>
        ) : (
          <span className="rounded-lg border border-line/50 px-3 py-1.5 text-sm text-ink-soft opacity-50">
            Previous
          </span>
        )}
        <span className="px-1 text-sm text-ink-soft">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref(href, page + 1, params)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:border-accent"
          >
            Next
          </Link>
        ) : (
          <span className="rounded-lg border border-line/50 px-3 py-1.5 text-sm text-ink-soft opacity-50">
            Next
          </span>
        )}
      </div>
    </div>
  );
}

export const DEFAULT_PAGE_SIZE = 25;
