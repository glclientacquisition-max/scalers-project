/**
 * Whether Calls detail has a usable recording source.
 * Does not inspect providers. A future signed URL is enough.
 */

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
