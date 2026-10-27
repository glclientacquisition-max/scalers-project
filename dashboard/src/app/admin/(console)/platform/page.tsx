import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { ServicesScreen } from "../_screens/ServicesScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/services. Old shell: unchanged. */
export default async function Page() {
  await requireSuperAdmin();
  if (isAdminV2Enabled()) redirect("/admin/settings/services");
  return <ServicesScreen />;
}
