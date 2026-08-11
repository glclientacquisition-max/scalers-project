"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";

/**
 * Soft clear: owners cannot hard-delete calls (RLS).
 * "Done" marks the lead resolved and removes it from the needs-you queue.
 */
export function MarkLeadDoneButton({
  callId,
  disabled = false,
}: {
  callId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) {
    return <span className="text-xs font-medium text-ok">Cleared</span>;
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await updateLeadStatus(callId, "resolved");
            if (!res.ok) {
              setError(res.error || "Could not clear.");
              return;
            }
            setDone(true);
            router.refresh();
          });
        }}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-ok hover:text-ok focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
      >
        {pending ? "Clearing…" : "Done"}
      </button>
      {error ? <span className="text-xs text-warn">{error}</span> : null}
    </span>
  );
}
