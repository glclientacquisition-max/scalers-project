import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBusinessesPanel } from "@/components/AdminBusinessesPanel";
import { getAdminOverview } from "@/lib/admin";
import { logAdminError } from "@/lib/adminErrors";

export const instant = false;

export default async function AdminBusinessesPage() {
  let overview;
  try {
    overview = await getAdminOverview();
  } catch (err) {
    logAdminError("businesses", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminBusinessesPanel
        businesses={overview.businesses}
        pendingBusinesses={overview.pendingBusinesses}
        availableDids={overview.pool
          .filter((row) => row.status === "available")
          .map((row) => ({ e164: row.e164 }))}
      />
    </div>
  );
}
