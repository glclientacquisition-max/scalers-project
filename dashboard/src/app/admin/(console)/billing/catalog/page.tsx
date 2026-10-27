import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { isAdminV2Enabled } from "@/lib/adminV2";

export default async function AdminBillingCatalogRedirect() {
  await requireSuperAdmin();
  // ADMIN_V2: the catalog alias is cut; go straight to Packages. Old shell: unchanged.
  if (isAdminV2Enabled()) redirect("/admin/billing/packages");
  redirect("/admin/packages");
}
