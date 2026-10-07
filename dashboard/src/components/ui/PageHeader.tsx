import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { IconButtonLink } from "@/components/ui/IconButton";

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
        <IconButtonLink href={back.href} label={back.label} className="-ms-1" data-desk-back="">
          <ChevronLeftIcon aria-hidden="true" />
        </IconButtonLink>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-page text-ink">{title}</h1>
        {meta ? <p className="mt-0.5 truncate text-meta text-ink-2">{meta}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
