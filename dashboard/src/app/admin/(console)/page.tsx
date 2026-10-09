import { AdminOverviewPanel } from "@/components/AdminOverviewPanel";
import { AdminSetupError } from "@/components/AdminSetupError";
import { getAdminOverview } from "@/lib/admin";
import { noQualityBadges, qualityBadges } from "@/lib/adminQuality";
import { droppingAttentionRows } from "@/lib/adminQualityModel";
import { logAdminError } from "@/lib/adminErrors";
import { evaluatePlatformOps } from "@/lib/platformOps";
import { mergeQueueRows } from "@/lib/platformOpsModel";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminOverviewPage() {
  await requireSuperAdmin();
  let overview;
  let ops;
  let badges;
  try {
    [overview, ops, badges] = await Promise.all([
      getAdminOverview(),
      evaluatePlatformOps(),
      qualityBadges().catch(noQualityBadges("overview:quality")),
    ]);
  } catch (err) {
    logAdminError("overview", err);
    return <AdminSetupError />;
  }

  const queue = [
    ...mergeQueueRows({
      notices: ops.notices.map((notice) => ({
        kind: notice.kind,
        detail: notice.detail,
        status: notice.status,
      })),
      businesses: overview.attention.map((b) => ({
        id: b.id,
        name: b.business_name,
        status: b.status,
        packageName: b.package_name,
      })),
    }),
    ...droppingAttentionRows(
      badges,
      overview.businesses.map((b) => ({ id: b.id, name: b.business_name })),
    ),
  ];

  return (
    <AdminOverviewPanel
      queue={queue}
      needsNumber={overview.waitingForNumber > 0 || overview.availableDids === 0}
      strip={ops.strip}
      glance={{
        totalBusinesses: overview.totalBusinesses,
        activeBusinesses: overview.activeBusinesses,
        waitingForNumber: overview.waitingForNumber,
        withoutPackage: overview.withoutPackage,
        availableDids: overview.availableDids,
        assignedDids: overview.assignedDids,
        callsLast7Days: overview.callsLast7Days,
      }}
    />
  );
}
