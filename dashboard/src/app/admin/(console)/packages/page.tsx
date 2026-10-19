import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPackageVersionsPanel } from "@/components/AdminPackageVersionsPanel";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadPackageCatalog } from "@/lib/packageCatalog";
import { loadPackageVersionEditor } from "@/lib/packageVersionCatalog";

export const instant = false;

export default async function AdminPackagesPage() {
  await requireSuperAdmin();
  try {
    const [live, editor] = await Promise.all([loadPackageCatalog(), loadPackageVersionEditor()]);
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Packages" subtitle="Catalog, rates, and which shops are on each plan." />
        <AdminPackageVersionsPanel catalog={editor.catalog} businesses={editor.businesses}>
          <AdminPackagesPanel {...live} />
        </AdminPackageVersionsPanel>
      </div>
    );
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }
}
