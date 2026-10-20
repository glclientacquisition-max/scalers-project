import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminPackageVersionsPanel } from "@/components/AdminPackageVersionsPanel";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadPackageVersionEditor } from "@/lib/packageVersionCatalog";

export const instant = false;

export default async function AdminPackagesPage() {
  await requireSuperAdmin();
  try {
    const editor = await loadPackageVersionEditor();
    return (
      <div className="space-y-4">
        <AdminPageHeader title="Plans" />
        <AdminPackageVersionsPanel catalog={editor.catalog} businesses={editor.businesses} />
      </div>
    );
  } catch (err) {
    logAdminError("packages", err);
    return <AdminSetupError />;
  }
}
