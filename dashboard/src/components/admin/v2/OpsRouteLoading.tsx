import { OpsSkeleton, SkelHeadline, SkelKpi, SkelSplit, SkelTable, type SkelCol } from "@/components/ops";
import "@/styles/ops.css";

const BIZ: SkelCol[] = [{ w: "w-[28%]" }, { w: "w-[16%]" }, { w: "w-[18%]" }, { w: "w-[18%]" }, { w: "w-[20%]", end: true }];
const NUM: SkelCol[] = [{ w: "w-[22%]" }, { w: "w-[14%]" }, { w: "w-[24%]" }, { w: "w-[20%]" }, { w: "w-[20%]", end: true }];
const QUAL: SkelCol[] = [{ w: "w-[28%]" }, { w: "w-[12%]" }, { w: "w-[16%]" }, { w: "w-[24%]" }, { w: "w-[10%]", end: true }, { w: "w-[10%]", end: true }];
const INV: SkelCol[] = [{ w: "w-[18%]" }, { w: "w-[22%]" }, { w: "w-[14%]" }, { w: "w-[14%]", end: true }, { w: "w-[14%]", end: true }, { w: "w-[18%]" }];
const PKG: SkelCol[] = [{ w: "w-[28%]" }, { w: "w-[18%]" }, { w: "w-[18%]", end: true }, { w: "w-[18%]", end: true }, { w: "w-[18%]" }];

/** Ops-shaped route loaders (ADMIN_V2). No SkeletonList / ui Skeleton. MASTER canvas + ops-* density. */
export function OpsLoadingBusinesses() {
  return <SkelSplit cols={BIZ} rows={12} />;
}
export function OpsLoadingNumbers() {
  return <SkelSplit cols={NUM} rows={12} />;
}
export function OpsLoadingQuality() {
  return <SkelSplit cols={QUAL} rows={10} />;
}
export function OpsLoadingInvoices() {
  return <SkelSplit cols={INV} rows={12} />;
}
export function OpsLoadingPackages() {
  return (
    <div className="ops-theme flex flex-col gap-ops-3 pe-ops-4" aria-busy="true">
      <div className="flex items-center gap-3 pb-ops-2"><span className="sr-only">Loading packages</span></div>
      <SkelSplit cols={PKG} rows={8} pane={false} />
    </div>
  );
}
export function OpsLoadingBillingHome() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true">
      <SkelHeadline />
      <SkelKpi tiles={4} />
      <SkelSplit cols={INV.slice(0, 5)} rows={8} />
    </div>
  );
}
export function OpsLoadingPayments() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true">
      <div className="flex items-center justify-between pb-ops-2">
        <span className="h-6 w-32 rounded-sm bg-surface-2" aria-hidden />
        <span className="h-8 w-28 rounded-sm bg-surface-2" aria-hidden />
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-sm border border-hairline bg-surface">
          <div className="h-10 border-b border-hairline bg-surface-2/50" />
          {Array.from({ length: 4 }, (_, r) => (
            <div key={r} className="grid h-ops-row grid-cols-[12rem_1fr] gap-ops-4 border-b border-hairline px-ops-3 last:border-b-0">
              <span className="self-center h-3 w-24 rounded-sm bg-surface-2" />
              <span className="self-center h-3 w-2/5 rounded-sm bg-surface-2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
export function OpsLoadingSettings() {
  return <OpsLoadingPayments />;
}
/** Overview / console root — Attention band + list density. */
export function OpsLoadingConsole() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true">
      <SkelHeadline />
      <SkelSplit cols={BIZ} rows={10} />
    </div>
  );
}
/** Business detail (old shell) or pane-open flash — list + pane. */
export function OpsLoadingBusinessDetail() {
  return <SkelSplit cols={BIZ} rows={10} />;
}
/** Invoice detail — headline, money line, event rows. */
export function OpsLoadingInvoiceDetail() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true" aria-label="Loading invoice">
      <SkelHeadline />
      <div className="flex flex-col gap-ops-2 border-b border-hairline pb-ops-3" aria-hidden="true">
        <OpsSkeleton className="h-3 w-40" />
        <OpsSkeleton className="h-5 w-24" />
        <OpsSkeleton className="h-4 w-64 max-w-full" />
      </div>
      {Array.from({ length: 3 }, (_, s) => (
        <section key={s} className="flex flex-col gap-ops-2" aria-hidden="true">
          <OpsSkeleton className="h-2.5 w-28" />
          {Array.from({ length: 4 }, (_, r) => (
            <div key={r} className="grid h-ops-row grid-cols-[1fr_7rem] items-center gap-ops-3 border-b border-hairline last:border-b-0">
              <OpsSkeleton className="h-3 w-3/5" />
              <OpsSkeleton className="ms-auto h-3 w-16" />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
/** Quality business drill-in — title + call table. */
export function OpsLoadingQualityDetail() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true" aria-label="Loading quality">
      <div className="flex flex-col gap-ops-2 pb-ops-2" aria-hidden="true">
        <OpsSkeleton className="h-6 w-48" />
        <OpsSkeleton className="h-7 w-24" />
      </div>
      <SkelTable cols={QUAL} rows={8} label="quality-detail" />
    </div>
  );
}
/** Quality call trace — title + stacked surface blocks. */
export function OpsLoadingQualityCall() {
  return (
    <div className="ops-theme flex flex-col gap-ops-4 pe-ops-4" aria-busy="true" aria-label="Loading call">
      <div className="flex flex-col gap-ops-2" aria-hidden="true">
        <OpsSkeleton className="h-6 w-48" />
        <OpsSkeleton className="h-7 w-16" />
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-sm border border-hairline bg-surface p-ops-3" aria-hidden="true">
          <OpsSkeleton className="mb-ops-2 h-3 w-28" />
          <OpsSkeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
/** Platform / Services redirect flash — settings card density. */
export function OpsLoadingPlatform() {
  return <OpsLoadingSettings />;
}
