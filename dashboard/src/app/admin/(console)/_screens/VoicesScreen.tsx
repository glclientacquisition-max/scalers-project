/** Shared by /admin/voices (old shell) and /admin/settings/voices (ADMIN_V2). */
import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminVoicesManager } from "@/components/AdminVoicesManager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminVoicesV2 } from "@/components/admin/v2/AdminVoicesV2";
import { logAdminError } from "@/lib/adminErrors";
import { listPlatformSonioxVoicesAdmin } from "@/lib/sonioxVoiceCatalog";
import { requireSuperAdmin } from "@/lib/adminGuard";

export async function VoicesScreen() {
  await requireSuperAdmin();
  let voices;
  try {
    voices = await listPlatformSonioxVoicesAdmin();
  } catch (err) {
    logAdminError("voices", err);
    return <AdminSetupError />;
  }

  if (process.env.ADMIN_V2 === "on") {
    return <AdminVoicesV2 voices={voices} />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader title="Voices" subtitle="What the desk hears." />
      <AdminVoicesManager initialVoices={voices} />
    </div>
  );
}
