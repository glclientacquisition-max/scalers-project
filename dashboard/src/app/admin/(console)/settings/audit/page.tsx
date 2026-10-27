import { requireSuperAdmin } from "@/lib/adminGuard";
import { notFound } from "next/navigation";
import { AuditScreen } from "../../_screens/AuditScreen";
import { isAdminV2Enabled } from "@/lib/adminV2";

export const instant = false;

/** ADMIN_V2 home for this screen. The old shell keeps /admin/activity. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; actor?: string }>;
}) {
  await requireSuperAdmin();
  if (!isAdminV2Enabled()) notFound();
  return <AuditScreen searchParams={searchParams} />;
}
