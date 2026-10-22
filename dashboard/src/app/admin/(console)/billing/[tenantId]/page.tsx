import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";

export default async function AdminBillingClientRedirect({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireSuperAdmin();
  const { tenantId } = await params;
  redirect(`/admin/businesses/${tenantId}?money=1`);
}
