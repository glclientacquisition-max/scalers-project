import { notFound } from "next/navigation";
import { LineView } from "@/app/onboarding/line/LineView";

export const instant = false;

export default async function DevLinePage({ searchParams }: { searchParams: Promise<{ pending?: string; option?: string; tenant?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const option = sp.option === "main" ? "main_number" : sp.option === "forward" ? "forward" : null;
  // ?tenant= keeps fixture states apart in localStorage (each state its own key).
  const tenantId = `dev-tenant${sp.tenant ? `-${sp.tenant.replace(/[^a-z0-9-]/gi, "").slice(0, 24)}` : ""}`;
  return (
    <LineView
      businessName="Westlands Phones"
      tenantId={tenantId}
      raw={sp.pending === "1" ? "pending" : "+254711082000"}
      initialOption={option}
    />
  );
}
