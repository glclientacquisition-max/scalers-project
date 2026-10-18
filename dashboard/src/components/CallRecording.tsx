import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import {
  NO_RECORDING_COPY,
  RECORDING_RETENTION_DELETED_COPY,
  RECORDING_RETENTION_NOTE,
  usableRecordingUrl,
} from "@/lib/recordingSource";

export function CallRecording({
  recordingUrl,
  retentionDeleted = false,
  variant = "auto",
}: {
  recordingUrl: string | null | undefined;
  retentionDeleted?: boolean;
  variant?: "auto" | "empty" | "player";
}) {
  if (retentionDeleted) {
    if (variant === "player") return null;
    return (
      <div className="mt-3" data-testid="call-recording-retention">
        <p className="text-body text-ink-2" data-testid="call-recording-deleted">
          {RECORDING_RETENTION_DELETED_COPY}
        </p>
        <p className="mt-1 text-meta text-ink-3">{RECORDING_RETENTION_NOTE}</p>
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
      <p className="mt-2 text-meta text-ink-3">{RECORDING_RETENTION_NOTE}</p>
    </div>
  );
}
