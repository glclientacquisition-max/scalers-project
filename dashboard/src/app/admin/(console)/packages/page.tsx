import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { PackagesScreen } from "../_screens/PackagesScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2: lives at /admin/billing/packages. Old shell: unchanged. */
export default async function Page() {
  await requireSuperAdmin();
  if (isAdminV2Enabled()) redirect("/admin/billing/packages");
  return <PackagesScreen />;
}
