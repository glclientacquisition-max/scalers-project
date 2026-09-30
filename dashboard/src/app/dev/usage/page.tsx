import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { deskListTitleClass } from "@/components/ui/deskChrome";

/**
 * Local Usage harness (no desk login). DASHBOARD_OPEN=true only.
 * Pull calls router.refresh. It does not start a payment.
 */
export default function DevUsagePage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  const meters = [
    ["Minutes", "240"],
    ["Balance", "0"],
  ];

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <div className="max-w-3xl min-w-0">
            <h1 className={deskListTitleClass}>Usage</h1>
            <p className="mt-3 text-sm text-ink-soft">Starter / month</p>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              {meters.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-3">
                  <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
