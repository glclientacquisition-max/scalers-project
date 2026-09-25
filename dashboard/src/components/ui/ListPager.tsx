"use client";

import { useState } from "react";
import { deskShiftClass } from "@/components/ui/deskChrome";
import { listPageSpan } from "@/lib/listPage";

type Props = {
  /** 1-based page. */
  page: number;
  pageSize: number;
  total: number;
  /** Singular noun. Omitted uses item / items. */
  noun?: string;
  onPage: (page: number) => void;
  className?: string;
};

function countLabel(noun: string | undefined, count: number): string {
  if (!noun) return count === 1 ? "item" : "items";
  return count === 1 ? noun : `${noun}s`;
}

function controlClass(enabled: boolean) {
  return enabled
    ? `inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink ${deskShiftClass} hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
    : "inline-flex min-h-11 items-center rounded-lg border border-line/50 px-3 text-sm text-ink-soft opacity-50";
}

/** In-memory Previous / Next. Same chrome as `Pagination`. */
export function ListPager({ page, pageSize, total, noun, onPage, className }: Props) {
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

  const jumpId = `list-page-${noun || "items"}`;

  return (
    <div className={frame}>
      <p className="text-sm text-ink-soft">
        {span.from}-{span.to} of {total} {label}
      </p>
      <div className="flex items-center gap-2">
        {span.page > 1 ? (
          <button type="button" className={controlClass(true)} onClick={() => onPage(span.page - 1)}>
            Previous
          </button>
        ) : (
          <span className={controlClass(false)}>Previous</span>
        )}
        {span.pages > 5 ? (
          <PageJump
            key={span.page}
            id={jumpId}
            page={span.page}
            pages={span.pages}
            onPage={onPage}
          />
        ) : (
          <span className="px-1 text-sm text-ink-soft">
            {span.page} / {span.pages}
          </span>
        )}
        {span.page < span.pages ? (
          <button type="button" className={controlClass(true)} onClick={() => onPage(span.page + 1)}>
            Next
          </button>
        ) : (
          <span className={controlClass(false)}>Next</span>
        )}
      </div>
    </div>
  );
}

function PageJump({
  id,
  page,
  pages,
  onPage,
}: {
  id: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = Number.parseInt(draft, 10);
        if (!Number.isFinite(next)) return;
        onPage(Math.min(pages, Math.max(1, next)));
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Page
      </label>
      <input
        id={id}
        key={page}
        type="number"
        min={1}
        max={pages}
        defaultValue={page}
        onChange={(event) => setDraft(event.target.value)}
        className={`h-11 w-14 rounded-lg border border-line bg-surface px-2 text-center text-sm tabular-nums text-ink-soft ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
      />
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Go
      </button>
    </form>
  );
}
