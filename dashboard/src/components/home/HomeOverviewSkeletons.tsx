import { Skeleton, SkeletonHeader } from "@/components/ui/Skeleton";

/** Overview skeletons (D2). Each matches the box it stands in for, so nothing jumps when data lands. */

/** Same box as HomeUsageSection: border-t, two lines. */
export function HomeUsageSkeleton() {
  return (
    <section aria-label="Usage" aria-busy="true" className="border-t border-hairline px-4 py-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-1.5 h-3.5 w-24" />
    </section>
  );
}

/** Same frame as CallInsights: caption row, then a grouped list of three. */
export function HomeInsightsSkeleton() {
  return (
    <section aria-busy="true" aria-label="Loading" className="min-w-0 space-y-1.5">
      <div className="flex min-h-11 items-end justify-between gap-3 px-1">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex min-h-14 items-center gap-3 px-4 py-2" aria-hidden="true">
            <span className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-1.5 h-3.5 w-4/5" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Route skeleton for Overview: header, Work list, side card. Matches the
 * loaded grid so nothing jumps when the page lands.
 */
export function HomeSkeleton() {
  return (
    <div className="w-full min-w-0" aria-busy="true">
      <SkeletonHeader />
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-7">
          <div className="flex items-end justify-between gap-3" aria-hidden="true">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex min-h-12 items-center justify-between gap-3 px-4 lg:min-h-11" aria-hidden="true">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-8" />
              </li>
            ))}
          </ul>
        </div>
        <aside className="min-w-0 lg:col-span-5 lg:col-start-8">
          <div className="overflow-hidden rounded-2xl border border-hairline bg-surface" aria-hidden="true">
            <div className="flex min-h-11 items-center justify-between gap-3 px-5 py-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6" />
            </div>
            <div className="border-t border-hairline px-4 py-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-1.5 h-3.5 w-32" />
            </div>
            <div className="border-t border-hairline px-4 py-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-1.5 h-3.5 w-24" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
