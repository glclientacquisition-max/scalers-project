import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { BillingFixture } from "./BillingFixture";
import { BILLING_PREVIEWS, type BillingPreview } from "./previews";

export const instant = false;

/** Plan, Billing, Usage, Team, and Home fixtures in the desk shell. DASHBOARD_OPEN=true only. Not a live workspace. */
export default async function DevBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const raw = (await searchParams).view || "plan-beta";
  const view: BillingPreview = BILLING_PREVIEWS.includes(raw as BillingPreview) ? (raw as BillingPreview) : "plan-beta";
  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/billing?view=home-beta" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <BillingFixture view={view} />
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
