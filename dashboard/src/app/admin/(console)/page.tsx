import { AdminTodayPanel } from "@/components/AdminTodayPanel";
import { AdminSetupError } from "@/components/AdminSetupError";
import { getAdminOverview } from "@/lib/admin";
import { noQualityBadges, qualityBadges } from "@/lib/adminQuality";
import { droppingAttentionRows } from "@/lib/adminQualityModel";
import { logAdminError } from "@/lib/adminErrors";
import { businessesWithRecentCalls, loadTodayCallCounts } from "@/lib/adminToday";
import {
  eatDayLabel,
  quietCandidates,
  statusSentence,
  todayNumberRows,
  todayQueue,
  type TodayBusiness,
} from "@/lib/adminTodayModel";
import { readPlatformOps } from "@/lib/platformOps";
import { mergeQueueRows } from "@/lib/platformOpsModel";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadOverdueInvoiceTodayRows } from "@/lib/adminBillingInvoices";
import { AdminAttentionV2 } from "@/components/admin/v2/AdminAttentionV2";
import { loadOverdueForAttention, loadUsageForAttention } from "@/lib/adminAttentionLoad";
import { buildAttention, type AttentionKind } from "@/lib/ops/attentionView";
import { loadInsightFacts } from "@/lib/adminInsightsLoad";
import { missedDemand } from "@/lib/ops/insightsView";

export const instant = false;

/**
 * Today. Reads only. The notice check and alert mail run on the ops cron, not here.
 */
export default async function AdminTodayPage() {
  await requireSuperAdmin();
  const now = new Date();
  let overview;
  let ops;
  let counts;
  let badges;
  try {
    [overview, ops, counts, badges] = await Promise.all([
      getAdminOverview(),
      readPlatformOps(),
      loadTodayCallCounts(now),
      qualityBadges().catch(noQualityBadges("today:quality")),
    ]);
  } catch (err) {
    logAdminError("today", err);
    return <AdminSetupError />;
  }

  const businesses: TodayBusiness[] = overview.businesses.map((b) => ({
    id: b.id,
    name: b.business_name,
    status: b.status,
    createdAt: b.created_at,
    packageName: b.package_name,
  }));
  if (process.env.ADMIN_V2 === "on") {
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

  const [calling, overdueInvoices] = await Promise.all([
    businessesWithRecentCalls(quietCandidates(businesses, now), now),
    loadOverdueInvoiceTodayRows(),
  ]);

  const noticeRows = mergeQueueRows({
    notices: ops.notices.map((notice) => ({ kind: notice.kind, detail: notice.detail, status: notice.status })),
    businesses: [],
  });

  return (
    <AdminTodayPanel
      dayLabel={eatDayLabel(now)}
      status={statusSentence(ops.signals)}
      queue={[
        ...overdueInvoices,
        ...todayQueue({ noticeRows, businesses, callingBusinessIds: calling, now }),
        ...droppingAttentionRows(
          badges,
          overview.businesses.map((b) => ({ id: b.id, name: b.business_name })),
        ),
      ]}
      needsNumber={overview.waitingForNumber > 0 || overview.availableDids === 0}
      numbers={todayNumberRows(counts, now)}
    />
  );
}
