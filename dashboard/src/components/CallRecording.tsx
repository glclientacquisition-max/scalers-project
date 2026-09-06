import { CallAudioPlayer } from "@/components/CallAudioPlayer";
import {
  NO_RECORDING_COPY,
  usableRecordingUrl,
} from "@/lib/recordingSource";

export function CallRecording({
  recordingUrl,
  variant = "auto",
}: {
  recordingUrl: string | null | undefined;
  variant?: "auto" | "empty" | "player";
}) {
  const src = usableRecordingUrl(recordingUrl);
  if (!src) {
    if (variant === "player") return null;
    return (
      <p className="mt-3 text-sm text-ink-soft" data-testid="call-recording-empty">
        {NO_RECORDING_COPY}
      </p>
    );
  }
  if (variant === "empty") return null;
  return <CallAudioPlayer src={src} />;
}
