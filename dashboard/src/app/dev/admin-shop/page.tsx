import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminShopPeople } from "@/components/admin/AdminShopPeople";
import { AdminShopPanel } from "@/components/AdminShopPanel";
import { AdminShell } from "@/components/AdminNav";
import type { AdminBusiness } from "@/lib/admin";
import type { AdminShopPeople as PeopleData } from "@/lib/adminShopPeople";
import { Stamp } from "@/components/ui/Stamp";
import { previewLine, statusLabel, statusTone } from "@/lib/adminBusinessUi";

const BUSINESS: AdminBusiness = {
  id: "biz-sample",
  created_at: "2026-09-01T08:00:00.000Z",
  business_name: "Sample Shop",
  sautikit_virtual_number: "+254709221537",
  whatsapp_notification_number: "+254712345678",
  is_active: true,
  archived_at: null,
  line_status: "active",
  suspended_at: null,
  package_name: "Growth",
  package_period: "month",
  billing_enforcement: "off",
  status: "active",
  pre_archive: null,
};

const PEOPLE: PeopleData = {
  ownerUserId: "owner-1",
  members: [
    {
      userId: "owner-1",
      email: "owner@example.com",
      name: "Amina K",
      role: "owner",
      joinedAt: "2026-09-01T08:00:00.000Z",
    },
    {
      userId: "admin-1",
      email: "ops@example.com",
      name: "Brian O",
      role: "admin",
      joinedAt: "2026-09-15T10:00:00.000Z",
    },
  ],
  invites: [{ id: "inv-1", email: "staff@example.com", role: "staff", state: "pending", expiresAt: "2026-11-01T00:00:00.000Z" }],
  seats: { used: 3, included: 5, full: false, members: 2, pending: 1 },
  totals: { members: 2, invites: 1 },
  limits: { members: 25, invites: 10 },
  seatOffer: null,
};

/** Shop hub fixture for visual review. DASHBOARD_OPEN=true only. */
export default function DevAdminShopPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <AdminShell operatorName="alvin">
      <div className="space-y-4">
        <AdminPageHeader title={BUSINESS.business_name} subtitle={previewLine(BUSINESS)} />
        <div className="px-4">
          <Stamp tone={statusTone(BUSINESS.status)}>{statusLabel(BUSINESS.status)}</Stamp>
        </div>
        <AdminShopPanel business={BUSINESS} availableDids={[{ e164: "+254700111222" }]} freeCount={1} />
        <AdminShopPeople businessId={BUSINESS.id} people={PEOPLE} />
      </div>
    </AdminShell>
  );
}
