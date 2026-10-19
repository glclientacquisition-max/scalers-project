import { notFound } from "next/navigation";
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

export default async function AdminBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  let business;
  let badges;
  let availableDids;
  let people;
  try {
    const loaded = await getAdminBusinessById(id);
    if (!loaded) notFound();
    business = loaded.business;
    availableDids = loaded.availableDids;
    [badges, people] = await Promise.all([
      qualityBadges().catch(noQualityBadges(`business:${id}`)),
      loadAdminShopPeople(id).catch(() => null),
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
      />
      {people ? <AdminShopPeople businessId={business.id} people={people} /> : null}
    </div>
  );
}
