import Link from "next/link";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * The first row of every screen. Title on the baseline, optional Back on the start, one action on the end.
 * No wordmark, greeting, or date block above it. Nested screens pass `back`.
 */
export function PageHeader({
  title,
  back,
  action,
  meta,
  className,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  /** One control. `Button size="sm"` or an `IconButton`. */
  action?: ReactNode;
  /** One muted line under the title. Counts, not prose. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex min-h-11 items-center gap-2", className)}>
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          className="-ms-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ChevronLeftIcon className="h-6 w-6" aria-hidden="true" />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-page text-ink">{title}</h1>
        {meta ? <p className="mt-0.5 truncate text-meta text-ink-2">{meta}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
