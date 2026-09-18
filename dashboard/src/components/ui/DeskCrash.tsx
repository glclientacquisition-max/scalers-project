"use client";

import { btnPrimary } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";

export function DeskCrash({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className="max-w-xl">
      <DeskError>
        <p className="font-display text-2xl tracking-tight text-ink">{title}</p>
      </DeskError>
      <button type="button" onClick={onRetry} className={`${btnPrimary} mt-4`}>
        Try again
      </button>
    </div>
  );
}
