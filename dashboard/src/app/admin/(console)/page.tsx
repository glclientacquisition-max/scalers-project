import { AdminTodayPanel } from "@/components/AdminTodayPanel";
import { AdminSetupError } from "@/components/AdminSetupError";
import { getAdminOverview } from "@/lib/admin";
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

export const instant = false;

/**
 * Today. Reads only: the notice check and alert mail run on Platform, not here.
 */
export default async function AdminTodayPage() {
  await requireSuperAdmin();
  const now = new Date();
  let overview;
  let ops;
  let counts;
  try {
    [overview, ops, counts] = await Promise.all([getAdminOverview(), readPlatformOps(), loadTodayCallCounts(now)]);
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
  const calling = await businessesWithRecentCalls(quietCandidates(businesses, now), now);

  const noticeRows = mergeQueueRows({
    notices: ops.notices.map((notice) => ({ kind: notice.kind, detail: notice.detail, status: notice.status })),
    businesses: [],
  });

  return (
    <AdminTodayPanel
      dayLabel={eatDayLabel(now)}
      status={statusSentence(ops.signals)}
      queue={todayQueue({ noticeRows, businesses, callingBusinessIds: calling, now })}
      needsNumber={overview.waitingForNumber > 0 || overview.availableDids === 0}
      numbers={todayNumberRows(counts, now)}
    />
  );
}
