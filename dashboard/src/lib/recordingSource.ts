/**
 * Whether Calls detail has a usable recording source.
 * Does not inspect providers. A future signed URL is enough.
 */

export type EffectiveRetention = number | "never";

export function usableRecordingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasUsableRecordingSource(value: unknown): boolean {
  return usableRecordingUrl(value) != null;
}

export function recordingPlaybackKind(value: unknown): "player" | "empty" {
  return hasUsableRecordingSource(value) ? "player" : "empty";
}

export const NO_RECORDING_COPY = "No recording available for this call.";

/** Default when no platform or tenant policy is loaded (env fallback). */
export const RECORDING_RETENTION_DAYS = 30;

export const RECORDING_RETENTION_DELETED_COPY = `Recording deleted after ${RECORDING_RETENTION_DAYS} days`;

export const RECORDING_RETENTION_NOTE = `Recordings are kept for ${RECORDING_RETENTION_DAYS} days.`;

export function recordingRetentionNote(effective: EffectiveRetention): string | null {
  if (effective === "never") return null;
  return `Recordings are kept for ${effective} days.`;
}

export function recordingRetentionDeletedLabel(effective: EffectiveRetention): string | null {
  if (effective === "never") return null;
  return `Recording deleted after ${effective} days`;
}

export function defaultEffectiveRecordingRetention(): EffectiveRetention {
  return RECORDING_RETENTION_DAYS;
}

export function recordingDeletedByRetention(
  meta: Record<string, unknown> | null | undefined
): boolean {
  const at = meta?.recording_deleted_at;
  return typeof at === "string" && at.trim().length > 0;
}

/** Storage bucket Voice copies recordings into (src/db.js RECORDINGS_BUCKET). */
export const RECORDINGS_BUCKET = "call-recordings";

/** Seconds a Calls-page playback link stays valid. Re-signed on every page load. */
export const RECORDING_PLAYBACK_TTL_SECONDS = 60 * 60;

/**
 * Storage path of this call's own recording, or null.
 * Voice writes `${callSid}/<recording>.<ext>`; a path under any other call is
 * ignored so one row can never point the player at another call's audio.
 */
export function recordingStoragePath(
  meta: Record<string, unknown> | null | undefined,
  callSid: string | null | undefined
): string | null {
  const raw = meta && typeof meta.recording_path === "string" ? meta.recording_path.trim() : "";
  const sid = String(callSid || "").trim();
  if (!raw || !sid) return null;
  if (raw.includes("..") || raw.startsWith("/")) return null;
  if (!raw.startsWith(`${sid}/`)) return null;
  return raw;
}
