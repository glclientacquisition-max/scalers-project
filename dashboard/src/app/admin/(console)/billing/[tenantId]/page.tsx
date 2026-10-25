import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { businessPaneHref } from "@/lib/ops/businessPane";

export default async function AdminBillingClientRedirect({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireSuperAdmin();
  const { tenantId } = await params;
  if (process.env.ADMIN_V2 === "on") redirect(businessPaneHref(tenantId, "money"));
  redirect(`/admin/businesses/${tenantId}?money=1`);
}
