import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { isAdminV2Enabled } from "@/lib/adminV2";

export default async function AdminWalletsPage() {
  await requireSuperAdmin();
  // ADMIN_V2: Ledger is cut; money lives in Billing home. Old shell: unchanged.
  if (isAdminV2Enabled()) redirect("/admin/billing/home");
  redirect("/admin/businesses");
}
