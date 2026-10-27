import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound, redirect } from "next/navigation";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2: Settings opens on the General hub. */
export default async function Page() {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  redirect("/admin/settings/general");
}
