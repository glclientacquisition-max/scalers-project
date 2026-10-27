import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound } from "next/navigation";
import { ServicesScreen } from "../../_screens/ServicesScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/platform. */
export default async function Page() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  return <ServicesScreen />;
}
