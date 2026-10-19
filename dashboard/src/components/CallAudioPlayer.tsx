"use client";

import { useRef, useState } from "react";
import { usableRecordingUrl } from "@/lib/recordingSource";
import { deskShiftClass } from "@/components/ui/deskChrome";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Sticky recording player. Callers must pass a usable source.
 * Empty or whitespace src does not mount <audio>.
 */
export function CallAudioPlayer({ src }: { src: string }) {
  const playable = usableRecordingUrl(src);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState<number>(1);

  if (!playable) {
    return null;
  }

  function applySpeed(next: number) {
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  return (
    <div className="sticky bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom))] z-20 mt-8 border-t border-hairline bg-surface py-3 shadow-none md:bottom-0">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-2">
        <audio
          ref={audioRef}
          src={playable}
          controls
          preload="none"
          className="block h-12 w-full min-w-0 max-w-full"
          onPlay={() => {
            if (audioRef.current) audioRef.current.playbackRate = speed;
          }}
        />
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySpeed(s)}
              aria-pressed={speed === s}
              className={[
                "rounded-full border px-2.5 py-1 text-meta font-medium",
                deskShiftClass,
                speed === s
                  ? "border-[var(--accent)] bg-accent-fill text-accent-on-fill"
                  : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]/60",
              ].join(" ")}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
