import { getSupabaseAdmin } from "@/lib/supabase";
import {
  RECORDINGS_BUCKET,
  RECORDING_PLAYBACK_TTL_SECONDS,
  recordingStoragePath,
  usableRecordingUrl,
} from "@/lib/recordingSource";

type SignClient = {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number
      ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

/**
 * Playable recording for a call the caller has ALREADY tenant-scoped.
 * The stored recording_url is a 7-day signed link (or a 15-minute provider
 * link), so it goes stale; re-sign the private Storage object on each load.
 * Falls back to the stored URL when there is no copied object yet.
 */
export async function playableCallRecordingUrl(
  row: { sautikit_call_sid?: string | null; recording_url?: string | null },
  meta: Record<string, unknown> | null | undefined,
  client?: SignClient
): Promise<string | null> {
  const path = recordingStoragePath(meta, row.sautikit_call_sid);
  if (path) {
    try {
      const sb = client || (getSupabaseAdmin() as unknown as SignClient);
      const { data, error } = await sb.storage
        .from(RECORDINGS_BUCKET)
        .createSignedUrl(path, RECORDING_PLAYBACK_TTL_SECONDS);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch {
      // fall through to the stored link
    }
  }
  return usableRecordingUrl(row.recording_url);
}
