"use client";

import Link from "next/link";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { listPageSpan } from "@/lib/listPage";

export { DEFAULT_PAGE_SIZE, clampListPage } from "@/lib/listPage";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  href?: string;
  params?: Record<string, string | undefined>;
  onPage?: (page: number) => void;
  noun?: string;
  className?: string;
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

function countLabel(noun: string | undefined, count: number): string {
  if (!noun) return count === 1 ? "item" : "items";
  return count === 1 ? noun : `${noun}s`;
}

function pagerControlClass(enabled: boolean) {
  return enabled
    ? `inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink ${deskShiftClass} hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
    : "inline-flex min-h-11 items-center rounded-lg border border-line/50 px-3 text-sm text-ink-soft opacity-50";
}

export function Pagination({
  page,
  pageSize,
  total,
  href = "",
  params,
  onPage,
  noun,
  className,
}: Props) {
  const span = listPageSpan(page, pageSize, total);
  const label = countLabel(noun, total);
  const frame = [
    "flex flex-wrap items-center justify-between gap-3",
    className || "mt-5 border-t border-line/70 pt-4",
  ].join(" ");

  if (total <= 0) return null;
  if (total <= pageSize) {
    return (
      <p className={className ? `${className} text-sm text-ink-soft` : "mt-4 text-sm text-ink-soft"}>
        {total} {label}
      </p>
    );
  }

  const { page: safePage, from, to, pages: totalPages } = span;
  const jumpId = `page-jump-${(href || noun || "list").replace(/\W/g, "")}`;

  function prev() {
    return onPage ? (
      <button type="button" className={pagerControlClass(true)} onClick={() => onPage(safePage - 1)}>
        Previous
      </button>
    ) : (
      <Link href={buildHref(href, safePage - 1, params)} className={pagerControlClass(true)}>
        Previous
      </Link>
    );
  }

  function next() {
    return onPage ? (
      <button type="button" className={pagerControlClass(true)} onClick={() => onPage(safePage + 1)}>
        Next
      </button>
    ) : (
      <Link href={buildHref(href, safePage + 1, params)} className={pagerControlClass(true)}>
        Next
      </Link>
    );
  }

  return (
    <div className={frame}>
      <p className="text-sm text-ink-soft">
        {from}-{to} of {total}
        {noun ? ` ${label}` : ""}
      </p>
      <div className="flex items-center gap-2">
        {safePage > 1 ? prev() : <span className={pagerControlClass(false)}>Previous</span>}
        {totalPages > 5 ? (
          <form
            action={onPage ? undefined : href}
            method={onPage ? undefined : "get"}
            className="flex items-center gap-2"
            onSubmit={
              onPage
                ? (event) => {
                    event.preventDefault();
                    const nextPage = Number.parseInt(
                      String(new FormData(event.currentTarget).get("page") || ""),
                      10
                    );
                    if (!Number.isFinite(nextPage)) return;
                    onPage(Math.min(totalPages, Math.max(1, nextPage)));
                  }
                : undefined
            }
          >
            {!onPage && params
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
              defaultValue={safePage}
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
            {safePage} / {totalPages}
          </span>
        )}
        {safePage < totalPages ? next() : <span className={pagerControlClass(false)}>Next</span>}
      </div>
    </div>
  );
}
