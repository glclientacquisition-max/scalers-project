import { AdminSetupError } from "@/components/AdminSetupError";
import { AdminVoicesManager } from "@/components/AdminVoicesManager";
import { logAdminError } from "@/lib/adminErrors";
import {
  listPlatformSonioxVoicesAdmin,
  type PlatformSonioxVoiceRow,
} from "@/lib/sonioxVoiceCatalog";

// instant = false: request-time Super Admin data under the admin auth shell.
export const instant = false;

export default async function AdminVoicesPage() {
  let voices: PlatformSonioxVoiceRow[] = [];
  let loadError: string | null = null;
  try {
    voices = await listPlatformSonioxVoicesAdmin();
  } catch (err) {
    logAdminError("voices", err);
    loadError = "setup";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink">
          Voices
        </h1>
      </div>
      {loadError ? (
        <AdminSetupError />
      ) : (
        <AdminVoicesManager initialVoices={voices} />
      )}
    </div>
  );
}
