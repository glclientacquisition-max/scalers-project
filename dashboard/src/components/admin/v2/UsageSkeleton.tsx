import { OpsSkeleton, SkelHeadline, SkelPane, SkelPhoneRows, SkelTable, SplitLayout } from "@/components/ops";
import "@/styles/ops.css";

const BARS = [40, 62, 18, 75, 55, 30, 88, 46, 70, 24, 58, 80, 35, 66, 50, 20, 72, 44, 60, 28, 84, 52, 38, 68, 26, 78, 48, 64, 32, 56];

/** Mirrors the usage page: title, headline + actions, 4 facts, day bars, 5-column day table, and the day pane. */
export function UsageSkeleton() {
  const list = (
    <div className="flex min-h-0 flex-col gap-ops-3 pe-ops-4" aria-busy="true" aria-label="Loading usage">
      <OpsSkeleton className="h-6 w-64" />
      <SkelHeadline />
      <div className="grid grid-cols-2 gap-x-ops-4 gap-y-ops-2 md:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5"><OpsSkeleton className="h-2.5 w-24" /><OpsSkeleton className="h-4 w-32" /></div>
        ))}
      </div>
      <div className="flex h-28 items-end gap-px border-b border-hairline" aria-hidden="true">
        {BARS.map((h, i) => <span key={i} className="block flex-1 animate-pulse rounded-t-[2px] bg-surface-2 motion-reduce:animate-none" style={{ height: `${h}%` }} />)}
      </div>
      <OpsSkeleton className="h-3 w-3/4" />
      <SkelPhoneRows rows={10} />
      <div className="hidden md:block">
        <SkelTable rows={16} cols={[{ w: "w-1/4" }, { w: "", end: true }, { w: "", end: true }, { w: "", end: true }, { w: "", end: true }]} />
      </div>
    </div>
  );
  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout list={list} pane={<SkelPane facts={5} history={12} related={3} />} />
    </div>
  );
}
