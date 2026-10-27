import { notFound } from "next/navigation";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { AdminInsightsV2 } from "@/components/admin/v2/AdminInsightsV2";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadBusinessNames, loadInsightFacts } from "@/lib/adminInsightsLoad";
import { buildInsights, parseRange } from "@/lib/ops/insightsView";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** Call insights across businesses (ADMIN_V2 only). Counts only, aggregated on the server. ?days=7|30|90, ?business= opens the pane. */
export default async function AdminQualityInsightsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  const days = parseRange((await searchParams).days);
  try {
    const [facts, names] = await Promise.all([loadInsightFacts(days), loadBusinessNames()]);
    if (!facts) throw new Error("call facts read failed");
    return <AdminInsightsV2 data={buildInsights(facts, names, days)} />;
  } catch (err) {
    logAdminError("quality-insights-v2", err);
    return <DeskLoadError backHref="/admin/quality" backLabel="Quality">Call insights could not be loaded.</DeskLoadError>;
  }
}
