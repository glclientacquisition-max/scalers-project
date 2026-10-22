import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Shaped placeholder: pass the size of what it replaces. */
export function OpsSkeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none", className)} />;
}

/** Names the next action. No illustration. */
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg bg-surface p-ops-4">
      <p className="text-ops-body text-ink-2">{title}</p>
      {action}
    </div>
  );
}

/** What failed, in plain words, plus Retry. */
export function ErrorState({ title, onRetry }: { title: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg p-ops-4" style={{ background: "var(--ops-status-danger-bg)" }}>
      <p className="min-w-0 flex-1 text-ops-body" style={{ color: "var(--ops-status-danger-fg)" }}>{title}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="h-ops-touch rounded-sm px-3 text-ops-label text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand md:h-ops-row">
          Retry
        </button>
      ) : null}
    </div>
  );
}
