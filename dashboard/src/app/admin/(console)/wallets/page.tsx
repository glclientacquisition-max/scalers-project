import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminWalletsPage() {
  await requireSuperAdmin();
  // ADMIN_V2: Ledger is cut; money lives in Billing home. Old shell: unchanged.
  if (process.env.ADMIN_V2 === "on") redirect("/admin/billing/home");
  redirect("/admin/businesses");
}
