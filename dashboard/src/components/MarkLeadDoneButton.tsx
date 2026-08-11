"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";

type SoftAction = "resolved" | "archived";

/**
 * Soft clear / hide: owners cannot hard-delete calls (RLS).
 * Done = resolved (finished follow-up).
 * Archive = archived (hide from active inbox; still recoverable under Archived).
 */
export function MarkLeadActionButton({
  callId,
  action,
  disabled = false,
}: {
  callId: string;
  action: SoftAction;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = action === "archived" ? "Archive" : "Done";
  const busyLabel = action === "archived" ? "Archiving…" : "Saving…";
  const successLabel = action === "archived" ? "Archived" : "Done";
  const hoverClass =
    action === "archived"
      ? "hover:border-ink-soft hover:text-ink"
      : "hover:border-ok hover:text-ok";

  if (done) {
    return <span className="text-xs font-medium text-ok">{successLabel}</span>;
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await updateLeadStatus(callId, action);
            if (!res.ok) {
              setError(
                res.error ||
                  (action === "archived"
                    ? "Could not archive. Apply docs/supabase/lead_status_archive.sql if needed."
                    : "Could not mark done.")
              );
              return;
            }
            setDone(true);
            router.refresh();
          });
        }}
        className={[
          "rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50",
          hoverClass,
        ].join(" ")}
      >
        {pending ? busyLabel : label}
      </button>
      {error ? <span className="max-w-[14rem] text-xs text-warn">{error}</span> : null}
    </span>
  );
}

export function MarkLeadDoneButton({
  callId,
  disabled = false,
}: {
  callId: string;
  disabled?: boolean;
}) {
  return <MarkLeadActionButton callId={callId} action="resolved" disabled={disabled} />;
}

export function MarkLeadArchiveButton({
  callId,
  disabled = false,
}: {
  callId: string;
  disabled?: boolean;
}) {
  return <MarkLeadActionButton callId={callId} action="archived" disabled={disabled} />;
}
