"use client";

import { btnPrimary } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";

export default function SettingsError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl">
      <DeskError>
        <p className="font-display text-2xl tracking-tight text-ink">Business settings</p>
        <p className="mt-3 text-sm">Could not load Business settings.</p>
      </DeskError>
      <button type="button" onClick={reset} className={`${btnPrimary} mt-4`}>
        Try again
      </button>
    </div>
  );
}
