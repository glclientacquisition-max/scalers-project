import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminShopPeople } from "@/components/admin/AdminShopPeople";
import { AdminShopPanel } from "@/components/AdminShopPanel";
import { loadAdminShopPeople } from "@/lib/adminShopPeople";
import { previewLine, statusLabel, statusTone } from "@/lib/adminBusinessUi";
import { getAdminBusinessById } from "@/lib/admin";
import { noQualityBadges, qualityBadges } from "@/lib/adminQuality";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { Stamp } from "@/components/ui/Stamp";

export const instant = false;

export default async function AdminBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ money?: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  // ADMIN_V2 (locked 23 Oct, t178u): no full business page; the list opens with this business in the pane.
  if (process.env.ADMIN_V2 === "on") redirect(`/admin/businesses?pane=${encodeURIComponent(id)}`);
  const { money } = await searchParams;
  let business;
  let badges;
  let availableDids;
  let people;
  let billing;
  try {
    const loaded = await getAdminBusinessById(id);
    if (!loaded) notFound();
    business = loaded.business;
    availableDids = loaded.availableDids;
    const { loadAdminBillingClient } = await import("@/lib/adminBilling");
    [badges, people, billing] = await Promise.all([
      qualityBadges().catch(noQualityBadges(`business:${id}`)),
      loadAdminShopPeople(id).catch(() => null),
      loadAdminBillingClient(id).catch(() => null),
    ]);
  } catch (err) {
    logAdminError("business-detail", err);
    return <AdminSetupError />;
  }

  const badge = badges[business.id];

  return (
    <div className="space-y-8">
      <AdminPageHeader title={business.business_name} subtitle={previewLine(business)} />
      <div className="px-4">
        <Stamp tone={statusTone(business.status)}>{statusLabel(business.status)}</Stamp>
      </div>
      <AdminShopPanel
        business={business}
        badge={badge}
        availableDids={availableDids}
        freeCount={availableDids.length}
        billing={billing}
        focusMoney={money === "1"}
      />
      {people ? <AdminShopPeople businessId={business.id} people={people} /> : null}
    </div>
  );
}
