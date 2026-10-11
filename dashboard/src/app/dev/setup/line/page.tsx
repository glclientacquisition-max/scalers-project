import { notFound } from "next/navigation";
import { LineView } from "@/app/onboarding/line/LineView";

export const instant = false;

export default async function DevLinePage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  return <LineView businessName="Westlands Phones" tenantId="dev-tenant" raw={sp.pending === "1" ? "pending" : "+254711082000"} />;
}
