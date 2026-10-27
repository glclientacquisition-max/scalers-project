import { requireSuperAdmin } from "@/lib/adminGuard";
import { redirect } from "next/navigation";
import { VoicesScreen } from "../_screens/VoicesScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2: lives at /admin/settings/voices. Old shell: unchanged. */
export default async function Page() {
  await requireSuperAdmin();
  if (isAdminV2Enabled()) redirect("/admin/settings/voices");
  return <VoicesScreen />;
}
