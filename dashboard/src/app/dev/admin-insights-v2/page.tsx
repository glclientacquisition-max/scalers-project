import { notFound } from "next/navigation";
import { connection } from "next/server";
import "@/styles/admin-v2.css";
import { AdminShell } from "@/components/AdminNav";
import { AdminInsightsV2 } from "@/components/admin/v2/AdminInsightsV2";
import { InsightsSkeleton } from "@/components/admin/v2/InsightsSkeleton";
import { buildInsights, parseRange } from "@/lib/ops/insightsView";
import { ADMIN_INSIGHTS_FACTS, ADMIN_INSIGHTS_NAMES, ADMIN_INSIGHTS_NOW } from "../fixtures/adminInsights";

export const instant = false;

/** Call insights fixture (ADMIN_V2 shell). ?days=, ?business=, ?loading=1. DASHBOARD_OPEN=true only. */
export default async function DevAdminInsightsV2Page({ searchParams }: { searchParams: Promise<{ loading?: string; days?: string }> }) {
  await connection();
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const sp = await searchParams;
  const days = parseRange(sp.days);
  const since = Date.parse(ADMIN_INSIGHTS_NOW) - days * 86400_000;
  const rows = ADMIN_INSIGHTS_FACTS.filter((r) => Date.parse(r.createdAt) >= since);
  return (
    <AdminShell operatorName="alvin" v2>
      {sp.loading === "1" ? <InsightsSkeleton /> : <AdminInsightsV2 data={buildInsights(rows, ADMIN_INSIGHTS_NAMES, days, Date.parse(ADMIN_INSIGHTS_NOW))} />}
    </AdminShell>
  );
}
