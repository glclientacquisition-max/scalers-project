import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminBillingCatalogRedirect() {
  await requireSuperAdmin();
  // ADMIN_V2: the catalog alias is cut; go straight to Packages. Old shell: unchanged.
  if (process.env.ADMIN_V2 === "on") redirect("/admin/billing/packages");
  redirect("/admin/packages");
}
