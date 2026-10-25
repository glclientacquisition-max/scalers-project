import { notFound } from "next/navigation";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { AdminUsageV2 } from "@/components/admin/v2/AdminUsageV2";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { loadUsageV2 } from "@/lib/adminUsageV2Load";

export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Usage drill-down for one business (ADMIN_V2 only). ?from&to picks a past period, e.g. from an invoice. */
export default async function AdminBusinessUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireSuperAdmin();
  if (process.env.ADMIN_V2 !== "on") notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const range = await searchParams;
  let data;
  try {
    data = await loadUsageV2(id, range);
  } catch (err) {
    logAdminError("business-usage-v2", err);
    return (
      <DeskLoadError backHref={`/admin/businesses/${id}`} backLabel="Business">
        Usage could not be loaded.
      </DeskLoadError>
    );
  }
  if (!data) notFound();
  return <AdminUsageV2 data={data} tenantId={id} currentPeriod={data.currentPeriod} nowIso={new Date().toISOString()} />;
}
