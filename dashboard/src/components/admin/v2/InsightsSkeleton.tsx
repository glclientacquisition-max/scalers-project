import { OpsSkeleton } from "@/components/ops";
import "@/styles/ops.css";

/** Grey blocks in the shape of call insights: title and range, headline, reason table, business rows. */
export function InsightsSkeleton() {
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3" aria-busy="true" aria-label="Loading call insights">
      <div className="flex items-center justify-between"><OpsSkeleton className="h-6 w-40" /><OpsSkeleton className="h-7 w-48" /></div>
      <div className="flex items-end gap-ops-4 border-b border-hairline pb-ops-3">
        <div className="flex flex-col gap-ops-2">
          <OpsSkeleton className="h-3 w-64" />
          <OpsSkeleton className="h-8 w-32" />
          <OpsSkeleton className="h-4 w-80 max-w-full" />
        </div>
        <OpsSkeleton className="ms-auto hidden h-8 w-32 md:block" />
        <OpsSkeleton className="hidden h-8 w-20 md:block" />
      </div>
      <div className="flex flex-col gap-px">{Array.from({ length: 9 }, (_, i) => <OpsSkeleton key={i} className="h-9 w-full" />)}</div>
      <OpsSkeleton className="h-5 w-28" />
      <div className="flex flex-col gap-px">{Array.from({ length: 10 }, (_, i) => <OpsSkeleton key={i} className="h-9 w-full" />)}</div>
    </div>
  );
}
