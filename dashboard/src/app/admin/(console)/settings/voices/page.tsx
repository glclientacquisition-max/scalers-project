import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound } from "next/navigation";
import { VoicesScreen } from "../../_screens/VoicesScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/voices. */
export default async function Page() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  return <VoicesScreen />;
}
