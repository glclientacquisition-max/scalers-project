import { OpsSkeleton } from "@/components/ops";
import "@/styles/ops.css";

/** Grey blocks in the shape of the usage page: headline, facts, bars, rows. */
export function UsageSkeleton() {
  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3" aria-busy="true" aria-label="Loading usage">
      <OpsSkeleton className="h-6 w-64" />
      <div className="flex items-end gap-ops-4 border-b border-hairline pb-ops-3">
        <div className="flex flex-col gap-ops-2">
          <OpsSkeleton className="h-3 w-56" />
          <OpsSkeleton className="h-8 w-48" />
          <OpsSkeleton className="h-4 w-72" />
        </div>
        <OpsSkeleton className="ms-auto hidden h-8 w-20 md:block" />
        <OpsSkeleton className="hidden h-8 w-16 md:block" />
      </div>
      <div className="grid grid-cols-2 gap-ops-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <OpsSkeleton key={i} className="h-9" />)}
      </div>
      <OpsSkeleton className="h-28 w-full" />
      <div className="flex flex-col gap-px">
        {Array.from({ length: 16 }, (_, i) => <OpsSkeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
}
