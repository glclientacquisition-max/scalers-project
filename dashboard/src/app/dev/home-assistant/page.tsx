import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewDataChecksCard } from "@/components/structured/OverviewDataChecksCard";
import { HomeGetReadyCallsCard } from "@/components/HomeGetReadyCallsCard";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskAccountMenu } from "@/components/DeskAccountMenu";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { ThemePicker } from "@/components/ThemePicker";
import { devChapterOneTenant } from "@/lib/devChapterOneTenant";
import { loadReadyChecklist } from "@/lib/assistantSayVoice.server";
import { dataChecksFor } from "@/components/structured/StructuredSettingsSlots";

export const instant = false;

/**
 * Overview cards for Business Assistant rollout. DASHBOARD_OPEN=true only.
 * ?checks=1 shows import-parsed "Is this right?" rows (save = confirm copy).
 */
export default async function DevHomeAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ checks?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const showChecks = sp.checks === "1";
  const tenant = devChapterOneTenant;
  const readyChecklist = await loadReadyChecklist(tenant);
  const checks = showChecks
    ? dataChecksFor(tenant, { saveIsConfirm: true, readyItems: readyChecklist.items })
    : [];

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home-assistant" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <DeskAccountMenu name="Chapter One" tenantId="" workspaces={[]} />
        <main data-desk-main="" className={deskMainClass}>
          <Suspense fallback={null}>
            <DeskPhonePull />
          </Suspense>
          <HomeOverviewHeader today={{ iso: "2026-10-19", label: "Monday 19 October" }} />
          <div className="mt-6 max-w-xl space-y-6">
            {!readyChecklist.allDone ? (
              <HomeGetReadyCallsCard items={readyChecklist.items} checks={checks} />
            ) : null}
            {checks.length ? <OverviewDataChecksCard checks={checks} /> : null}
          </div>
          <div className="mt-8 max-w-lg">
            <ThemePicker />
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
