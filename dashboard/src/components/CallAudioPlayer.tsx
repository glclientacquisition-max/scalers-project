"use client";

import { useRef, useState } from "react";

const SPEEDS = [1, 1.5, 2] as const;

/**
 * Sticky recording player — stays visible while scrolling the transcript.
 * Includes playback speed toggles for busy owners.
 */
export function CallAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speed, setSpeed] = useState<number>(1);

  function applySpeed(next: number) {
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  return (
    <div className="sticky bottom-0 z-20 -mx-6 mt-8 border-t border-[var(--line)] bg-[var(--card)]/95 px-6 py-3 backdrop-blur sm:rounded-t-2xl">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <audio
          ref={audioRef}
          src={src}
          controls
          preload="none"
          className="h-10 min-w-0 flex-1"
          onPlay={() => {
            if (audioRef.current) audioRef.current.playbackRate = speed;
          }}
        />
        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySpeed(s)}
              aria-pressed={speed === s}
              className={[
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                speed === s
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
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
