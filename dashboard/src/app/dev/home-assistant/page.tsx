import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DataChecksCard } from "@/components/structured/DataChecksCard";
import { HomeGetReadyCallsCard } from "@/components/HomeGetReadyCallsCard";
import { HomeOverviewHeader } from "@/components/HomeOverviewHeader";
import { DeskAccountMenu } from "@/components/DeskAccountMenu";
import { DeskPhonePull } from "@/components/PhonePullSurface";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { ThemePicker } from "@/components/ThemePicker";
import { businessSettingsHref } from "@/lib/businessSettingsNav";

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

  const checklist = [
    { id: "identity", label: "Business name", href: "/settings?tab=train&panel=identity", complete: true },
    { id: "catalog", label: "Catalogue and prices", href: "/settings?tab=catalog", complete: false },
    { id: "hours", label: "Opening hours", href: "/settings?tab=train&panel=hours", complete: false },
    { id: "payment", label: "M-Pesa till", href: "/settings?tab=train&panel=policies", complete: false },
  ];

  const checks = showChecks
    ? [
        {
          href: businessSettingsHref("catalog"),
          label: "Check 2 prices",
          detail: "Imported from your notes. Press Save on Catalogue to use it.",
        },
        {
          href: businessSettingsHref("train", "policies"),
          label: "Check how customers pay",
          detail: "Imported from your payment notes. Press Save on Policies to use it.",
        },
      ]
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
            <HomeGetReadyCallsCard items={checklist} />
            {checks.length ? <DataChecksCard checks={checks} /> : null}
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
