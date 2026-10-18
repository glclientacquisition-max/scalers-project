import { notFound } from "next/navigation";
import { BillingFixture } from "./BillingFixture";

export const instant = false;

/** Plan and Billing fixtures. DASHBOARD_OPEN=true only. Not a live workspace. */
export default async function DevBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const raw = (await searchParams).view || "beta";
  const allowed = [
    "beta",
    "plan",
    "plan-annual",
    "plan-confirm",
    "billing",
    "billing-empty",
    "usage-beta",
    "usage-paid",
    "trial",
    "banner",
    "team",
  ] as const;
  const view = allowed.includes(raw as (typeof allowed)[number]) ? (raw as (typeof allowed)[number]) : "beta";
  return (
    <div className="desk-theme flex min-h-dvh flex-col bg-canvas px-4 py-4 sm:px-6 md:p-6">
      <BillingFixture view={view} />
    </div>
  );
}
