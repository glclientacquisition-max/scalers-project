import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPackagesPanel } from "@/components/AdminPackagesPanel";
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
      <AdminPackageVersionsPanel catalog={editor.catalog} businesses={editor.businesses}>
        <AdminPackagesPanel {...live} />
      </AdminPackageVersionsPanel>
    );
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }
}
