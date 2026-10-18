import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { logAdminError } from "@/lib/adminErrors";
import { loadPackageCatalog } from "@/lib/packageCatalog";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminPackagesPage() {
  await requireSuperAdmin();
  let catalog;
  try {
    catalog = await loadPackageCatalog();
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Packages" subtitle="Catalog, rates, and which shops are on each plan." />
      <AdminPackagesPanel {...catalog} />
    </div>
  );
}
