"use client";

import { useState } from "react";
import { deskPreviewClass, focusRingVisible } from "@/components/ui/deskChrome";
import { deskRowActionClass } from "@/components/ui/deskRowHit";

/** One truncated What line. Tap expands headline + detail in place. */
export function ContactTimelineWhat({
  headline,
  detail,
}: {
  headline: string;
  detail?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const extra = detail?.trim() || "";

  if (!extra) {
    return <p className={`font-medium text-ink ${deskPreviewClass}`}>{headline}</p>;
  }

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={`${deskRowActionClass} w-full min-h-11 rounded-lg text-left ${focusRingVisible}`}
    >
      {open ? (
        <>
          <p className="font-medium text-ink">{headline}</p>
          <p className="mt-0.5 text-ink-soft">{extra}</p>
        </>
      ) : (
        <p className={`font-medium text-ink ${deskPreviewClass}`}>{headline}</p>
      )}
    </button>
  );
}
