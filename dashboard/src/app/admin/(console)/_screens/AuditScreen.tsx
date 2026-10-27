/** Shared by /admin/activity (old shell) and /admin/settings/audit (ADMIN_V2). */
import { AdminActivityPanel } from "@/components/AdminActivityPanel";
import { AdminAuditV2 } from "@/components/admin/v2/AdminAuditV2";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { ACTIVITY_LIMIT, loadAdminActivity } from "@/lib/adminActivity";
import { activityItem, parseActivityFilters } from "@/lib/adminActivityModel";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { isAdminV2Enabled } from "@/lib/adminV2";

export async function AuditScreen({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; actor?: string }>;
}) {
  await requireSuperAdmin();
  const filters = parseActivityFilters(await searchParams);
  try {
    const { rows, businesses, actors } = await loadAdminActivity(filters);
    const names = new Map(businesses.map((b) => [b.id, b.name]));
    const items = rows.map((row) => activityItem(row, names));
    if (isAdminV2Enabled()) {
      return (
        <AdminAuditV2
          items={items}
          businesses={businesses}
          actors={actors}
          business={filters.business}
          actor={filters.actor}
          limit={ACTIVITY_LIMIT}
        />
      );
    }
    return (
      <AdminActivityPanel
        items={items}
        businesses={businesses}
        actors={actors}
        business={filters.business}
        actor={filters.actor}
        limit={ACTIVITY_LIMIT}
      />
    );
  } catch (err) {
    logAdminError("activity", err);
    return <DeskLoadError>Could not load activity.</DeskLoadError>;
  }
}
