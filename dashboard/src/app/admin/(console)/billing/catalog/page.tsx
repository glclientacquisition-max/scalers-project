import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminBillingCatalogRedirect() {
  await requireSuperAdmin();
  redirect("/admin/packages");
}
