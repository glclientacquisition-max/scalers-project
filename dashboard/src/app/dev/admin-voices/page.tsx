import { notFound } from "next/navigation";
import { AdminVoicesManager } from "@/components/AdminVoicesManager";
import type { PlatformSonioxVoiceRow } from "@/lib/sonioxVoiceCatalog";

/**
 * Super Admin Voices fixture. DASHBOARD_OPEN=true only.
 */
const VOICES: PlatformSonioxVoiceRow[] = [
  {
    id: "7b197f3c-84b4-4404-986f-114e4dac1432",
    description: "Warm Kenyan receptionist",
    is_default: true,
    is_active: true,
    sort_order: 1,
  },
  {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    description: "Clear Nairobi front desk",
    is_default: false,
    is_active: true,
    sort_order: 2,
  },
  {
    id: "11111111-2222-3333-4444-555555555555",
    description: "Quiet evening tone",
    is_default: false,
    is_active: false,
    sort_order: 3,
  },
];

export default function DevAdminVoicesPage() {
  if (process.env.DASHBOARD_OPEN !== "true") {
    notFound();
  }

  return (
    <main className="admin-theme min-h-screen bg-canvas px-4 py-8 text-ink sm:px-6">
      <div className="mx-auto max-w-desk space-y-16">
        <AdminVoicesManager initialVoices={VOICES} />
        <AdminVoicesManager initialVoices={[]} />
      </div>
    </main>
  );
}
