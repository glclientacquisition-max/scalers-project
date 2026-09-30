import { cx } from "@/lib/cx";

/** Shaped placeholder. Compose into the exact layout the loaded view will have. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("block animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none", className)}
    />
  );
}

export function SkeletonRow({ withActions = false }: { withActions?: boolean }) {
  return (
    <li className="flex items-center gap-3 bg-surface py-3 ps-4 pe-3" aria-hidden="true">
      <Skeleton className="h-10 w-10 rounded-full" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-3">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="ms-auto h-3 w-12" />
        </span>
        <Skeleton className="mt-2 h-3.5 w-4/5" />
      </span>
      {withActions ? (
        <span className="flex gap-1">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </span>
      ) : null}
    </li>
  );
}

export function SkeletonList({ rows = 6, withActions = false }: { rows?: number; withActions?: boolean }) {
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} withActions={withActions} />
      ))}
    </ul>
  );
}

export function SkeletonHeader() {
  return (
    <div className="flex min-h-11 items-center" aria-hidden="true">
      <Skeleton className="h-7 w-40" />
    </div>
  );
}
