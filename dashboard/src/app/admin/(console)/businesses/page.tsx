import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBusinessesPanel } from "@/components/AdminBusinessesPanel";
import { getAdminOverview } from "@/lib/admin";
import { noQualityBadges, qualityBadges } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminBusinessesPage() {
  await requireSuperAdmin();
  let overview;
  let badges;
  try {
    [overview, badges] = await Promise.all([getAdminOverview(), qualityBadges().catch(noQualityBadges("businesses:quality"))]);
  } catch (err) {
    logAdminError("businesses", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminBusinessesPanel
        businesses={overview.businesses}
        badges={badges}
        pendingBusinesses={overview.pendingBusinesses}
        availableDids={overview.pool
          .filter((row) => row.status === "available")
          .map((row) => ({ e164: row.e164 }))}
      />
    </div>
  );
}
