import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import {
  NO_RECORDING_COPY,
  defaultEffectiveRecordingRetention,
  recordingRetentionDeletedLabel,
  recordingRetentionNote,
  usableRecordingUrl,
} from "@/lib/recordingSource";
import type { EffectiveRetention } from "@/lib/recordingSource";

export function CallRecording({
  recordingUrl,
  retentionDeleted = false,
  effectiveRetention = defaultEffectiveRecordingRetention(),
  variant = "auto",
}: {
  recordingUrl: string | null | undefined;
  retentionDeleted?: boolean;
  effectiveRetention?: EffectiveRetention;
  variant?: "auto" | "empty" | "player";
}) {
  const deletedCopy = recordingRetentionDeletedLabel(effectiveRetention);
  const noteCopy = recordingRetentionNote(effectiveRetention);

  if (retentionDeleted) {
    if (variant === "player") return null;
    return (
      <div className="mt-3" data-testid="call-recording-retention">
        {deletedCopy ? (
          <p className="text-body text-ink-2" data-testid="call-recording-deleted">
            {deletedCopy}
          </p>
        ) : null}
        {noteCopy ? <p className="mt-1 text-meta text-ink-3">{noteCopy}</p> : null}
      </div>
    );
  }

  const src = usableRecordingUrl(recordingUrl);
  if (!src) {
    if (variant === "player") return null;
    return (
      <p className="mt-3 text-body text-ink-2" data-testid="call-recording-empty">
        {NO_RECORDING_COPY}
      </p>
    );
  }
  if (variant === "empty") return null;
  return (
    <div className="mt-3" data-testid="call-recording-player">
      <CallAudioPlayer src={src} />
      {noteCopy ? <p className="mt-2 text-meta text-ink-3">{noteCopy}</p> : null}
    </div>
  );
}
