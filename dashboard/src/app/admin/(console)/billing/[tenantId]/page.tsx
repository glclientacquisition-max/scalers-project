import { notFound } from "next/navigation";
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminBillingDetailPanel } from "@/components/AdminBillingDetailPanel";
import { deskListTitleClass, deskPreviewClass } from "@/components/ui/deskChrome";
import { logAdminError } from "@/lib/adminErrors";
import { loadAdminBillingClient } from "@/lib/adminBilling";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminBillingClientPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireSuperAdmin();
  const { tenantId } = await params;
  let detail;
  try {
    detail = await loadAdminBillingClient(tenantId);
  } catch (err) {
    logAdminError("billing-client", err);
    return <AdminSetupError />;
  }
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <h1 className={`${deskListTitleClass} ${deskPreviewClass}`}>{detail.row.business_name}</h1>
      <AdminBillingDetailPanel detail={detail} />
    </div>
  );
}
