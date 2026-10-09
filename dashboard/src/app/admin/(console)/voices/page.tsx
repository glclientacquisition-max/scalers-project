import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminVoicesManager } from "@/components/AdminVoicesManager";
import { logAdminError } from "@/lib/adminErrors";
import { listPlatformSonioxVoicesAdmin } from "@/lib/sonioxVoiceCatalog";
import { requireSuperAdmin } from "@/lib/adminGuard";

export const instant = false;

export default async function AdminVoicesPage() {
  await requireSuperAdmin();
  let voices;
  try {
    voices = await listPlatformSonioxVoicesAdmin();
  } catch (err) {
    logAdminError("voices", err);
    return <AdminSetupError />;
  }

  return (
    <div className="space-y-4">
      <AdminVoicesManager initialVoices={voices} />
    </div>
  );
}
