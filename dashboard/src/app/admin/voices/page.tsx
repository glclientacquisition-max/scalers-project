import { AdminVoicesManager } from "@/components/AdminVoicesManager";
import {
  listPlatformSonioxVoicesAdmin,
  type PlatformSonioxVoiceRow,
} from "@/lib/sonioxVoiceCatalog";

export default async function AdminVoicesPage() {
  let voices: PlatformSonioxVoiceRow[] = [];
  let loadError: string | null = null;
  try {
    voices = await listPlatformSonioxVoicesAdmin();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl tracking-tight text-[var(--ink)]">
          Voices
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--ink-soft)] leading-relaxed">
          Control which Soniox cloned voices workspaces can pick, and the
          descriptions owners see. Owners name each voice for their own desk.
        </p>
      </div>
      {loadError ? (
        <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
          Could not load voices: {loadError}
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Apply <code>docs/supabase/soniox_voice_id.sql</code> if the table is
            missing.
          </p>
        </div>
      ) : (
        <AdminVoicesManager initialVoices={voices} />
      )}
    </div>
  );
}
