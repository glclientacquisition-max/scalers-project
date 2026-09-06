/** Desk voice-sample playback. A blob is playable only when it is a real WAV. */

export const MIN_WAV_BYTES = 44;
export const NO_VOICE_SAMPLE_COPY = "No voice sample available.";

export function hasWavMagic(bytes: ArrayLike<number>): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}

export function isUsableWavBytes(bytes: ArrayLike<number>): boolean {
  return bytes.length >= MIN_WAV_BYTES && hasWavMagic(bytes);
}

function previewTypeLooksAudio(type: string): boolean {
  const normalized = type.toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("audio") ||
    normalized.includes("wav") ||
    normalized.includes("octet-stream")
  );
}

export async function isUsablePreviewAudioBlob(blob: Blob): Promise<boolean> {
  if (!blob || blob.size < MIN_WAV_BYTES) return false;
  if (!previewTypeLooksAudio(String(blob.type || ""))) return false;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return hasWavMagic(head);
}

export async function objectUrlFromPreviewResponse(res: Response): Promise<string> {
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(
      errJson && typeof errJson.error === "string"
        ? errJson.error
        : `Preview failed (${res.status})`
    );
  }
  const blob = await res.blob();
  if (!(await isUsablePreviewAudioBlob(blob))) {
    throw new Error(NO_VOICE_SAMPLE_COPY);
  }
  return URL.createObjectURL(blob);
}

export function isAutoplayBlock(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

export function isPlayablePreviewMetadata(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Never surface the browser media-error string in Desk UI. */
export function previewErrorCopy(err: unknown): string {
  const raw = err instanceof Error ? err.message.trim() : "";
  if (
    !raw ||
    /no supported source|failed to load|not supported/i.test(raw)
  ) {
    return NO_VOICE_SAMPLE_COPY;
  }
  return raw;
}

export function assertPreviewAudioPlayable(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const finish = (fn: () => void) => {
      audio.onerror = null;
      audio.onloadedmetadata = null;
      fn();
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const ok = isPlayablePreviewMetadata(audio.duration);
      finish(() => {
        if (ok) resolve();
        else reject(new Error(NO_VOICE_SAMPLE_COPY));
      });
    };
    audio.onerror = () => {
      finish(() => reject(new Error(NO_VOICE_SAMPLE_COPY)));
    };
    audio.src = url;
  });
}
