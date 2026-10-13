"use client";

import { useState } from "react";

const EMPTY_COPY = "No recording for this call";

/**
 * Inline recording for a traced call.
 * A missing source, or a 403 or 404 while loading, stays a calm empty line.
 */
export function QualityRecording({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <p className="text-body text-ink-3">{EMPTY_COPY}</p>;
  }
  return (
    <audio
      src={src}
      controls
      preload="none"
      className="block h-12 w-full max-w-xl"
      onError={() => setFailed(true)}
    />
  );
}
