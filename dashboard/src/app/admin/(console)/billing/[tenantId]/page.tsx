import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminBillingClientRedirect({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireSuperAdmin();
  const { tenantId } = await params;
  if (process.env.ADMIN_V2 === "on") redirect(`/admin/businesses?pane=${encodeURIComponent(tenantId)}&section=money`);
  redirect(`/admin/businesses/${tenantId}?money=1`);
}
