import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { deskFieldClass, deskListTitleClass } from "@/components/ui/deskChrome";

/**
 * Local Profile harness (no desk login). DASHBOARD_OPEN=true only.
 * A dirty field blocks pull. A clean field allows router.refresh.
 */
export default function DevSettingsPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <div className="max-w-3xl min-w-0" data-pull-dirty-guard="">
            <h1 className={deskListTitleClass}>Profile</h1>
            <form className="mt-4 space-y-3">
              <label htmlFor="dev-business-name" className="block text-xs font-medium uppercase tracking-wide text-ink-soft">
                Business name
              </label>
              <input
                id="dev-business-name"
                name="business_name"
                defaultValue="Chapter One Dental"
                autoComplete="organization"
                className={deskFieldClass}
              />
            </form>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
