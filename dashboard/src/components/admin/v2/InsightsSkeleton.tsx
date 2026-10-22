import { OpsSkeleton, SkelHeadline, SkelPane, SkelPhoneRows, SkelTable, SplitLayout } from "@/components/ops";
import "@/styles/ops.css";

/** Mirrors call insights: title + range, headline + actions, 4-column reason table (9 groups), 5-column business table, and the pane. */
export function InsightsSkeleton() {
  const list = (
    <div className="flex min-h-0 flex-col gap-ops-3 pe-ops-4" aria-busy="true" aria-label="Loading call insights">
      <div className="flex items-center justify-between gap-ops-2"><OpsSkeleton className="h-6 w-40" /><OpsSkeleton className="h-ops-touch w-48 md:h-7" /></div>
      <SkelHeadline />
      <SkelTable rows={9} cols={[{ w: "w-2/5" }, { w: "", end: true }, { w: "", end: true }, { w: "", end: true }]} />
      <OpsSkeleton className="h-5 w-28" />
      <SkelPhoneRows rows={6} />
      <div className="hidden md:block">
        <SkelTable rows={8} cols={[{ w: "w-1/4" }, { w: "", end: true }, { w: "w-1/4" }, { w: "", end: true }, { w: "", end: true }]} />
      </div>
    </div>
  );
  return (
    <div className="ops-theme flex min-h-0 w-full flex-col">
      <SplitLayout list={list} pane={<SkelPane facts={14} history={5} related={3} />} />
    </div>
  );
}
