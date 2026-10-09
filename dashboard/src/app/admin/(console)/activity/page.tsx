import { AdminActivityPanel } from "@/components/AdminActivityPanel";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { ACTIVITY_LIMIT, loadAdminActivity } from "@/lib/adminActivity";
import { activityItem, parseActivityFilters } from "@/lib/adminActivityModel";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; actor?: string }>;
}) {
  await requireSuperAdmin();
  const filters = parseActivityFilters(await searchParams);
  try {
    const { rows, businesses, actors } = await loadAdminActivity(filters);
    const names = new Map(businesses.map((b) => [b.id, b.name]));
    return (
      <AdminActivityPanel
        items={rows.map((row) => activityItem(row, names))}
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
