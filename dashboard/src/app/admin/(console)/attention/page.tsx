import { redirect } from "next/navigation";
import { AdminAttentionV2 } from "@/components/admin/v2/AdminAttentionV2";
import { getAdminOverview } from "@/lib/admin";
import { noQualityBadges, qualityBadges } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { AdminSetupError } from "@/components/AdminSetupError";
import { loadOverdueForAttention, loadUsageForAttention } from "@/lib/adminAttentionLoad";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { isAdminV2Enabled } from "@/lib/adminV2";
import { loadInsightFacts } from "@/lib/adminInsightsLoad";
import { buildAttention, type AttentionKind } from "@/lib/ops/attentionView";
import { missedDemand } from "@/lib/ops/insightsView";
import type { TodayBusiness } from "@/lib/adminTodayModel";

export const instant = false;

/** The needs-attention queue. Overview is the dashboard one tap back. */
export default async function AdminAttentionPage() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) redirect("/admin");
  const now = new Date();
  let overview;
  let badges;
  try {
    [overview, badges] = await Promise.all([
      getAdminOverview(),
      qualityBadges().catch(noQualityBadges("attention:quality")),
    ]);
  } catch (err) {
    logAdminError("attention", err);
    return <AdminSetupError />;
  }
  const businesses: TodayBusiness[] = overview.businesses.map((b) => ({
    id: b.id,
    name: b.business_name,
    status: b.status,
    createdAt: b.created_at,
    packageName: b.package_name,
  }));
  const [overdue, usage, facts] = await Promise.all([loadOverdueForAttention(), loadUsageForAttention(), loadInsightFacts(7)]);
  const unavailable: AttentionKind[] = [];
  if (!overdue) unavailable.push("overdue");
  if (!usage) unavailable.push("near-limit");
  if (!facts) unavailable.push("missed-demand");
  const items = buildAttention({
    businesses,
    overdue: overdue || [],
    usage: (usage || []).map((u) => ({ ...u, packageName: overview.businesses.find((b) => b.id === u.tenantId)?.package_name ?? null })),
    quality: Object.entries(badges)
      .filter(([, q]) => q.dropping)
      .map(([tenantId, q]) => ({ tenantId, score: q.score, reason: q.droppingReason })),
    missed: missedDemand(facts || [], now),
    now,
  });
  return <AdminAttentionV2 items={items} unavailable={unavailable} />;
}
