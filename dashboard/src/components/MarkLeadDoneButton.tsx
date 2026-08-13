"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";

type SoftAction = "resolved" | "archived";

function ArchiveGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7h18M5 7l1 12h12l1-12M9 7V5h6v2"
      />
    </svg>
  );
}

function DoneGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
    </svg>
  );
}

/**
 * Soft clear / hide: owners cannot hard-delete calls (RLS).
 * Done = resolved (finished follow-up).
 * Archive = archived (hide from active inbox; still recoverable under Archived).
 */
export function MarkLeadActionButton({
  callId,
  action,
  disabled = false,
  variant = "default",
}: {
  callId: string;
  action: SoftAction;
  disabled?: boolean;
  variant?: "default" | "icon";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = action === "archived" ? "Archive" : "Mark done";
  const busyLabel = action === "archived" ? "Archiving" : "Saving";
  const successLabel = action === "archived" ? "Archived" : "Done";

  if (done && variant === "icon") {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center text-ok"
        aria-label={successLabel}
        title={successLabel}
      >
        <DoneGlyph className="h-4 w-4" />
      </span>
    );
  }

  if (done) {
    return <span className="text-xs font-medium text-ok">{successLabel}</span>;
  }

  const iconButtonClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 disabled:opacity-50";

  return (
    <span
      className={
        variant === "icon"
          ? "inline-flex flex-col items-center"
          : "inline-flex flex-col items-start gap-1"
      }
    >
      <button
        type="button"
        disabled={disabled || pending}
        aria-label={pending ? busyLabel : label}
        title={pending ? busyLabel : label}
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
        className={
          variant === "icon"
            ? iconButtonClass
            : [
                "text-xs font-medium text-ink-soft underline-offset-2 transition hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 disabled:opacity-50",
              ].join(" ")
        }
      >
        {variant === "icon" ? (
          action === "archived" ? (
            <ArchiveGlyph className="h-4 w-4" />
          ) : (
            <DoneGlyph className="h-4 w-4" />
          )
        ) : pending ? (
          busyLabel
        ) : (
          label
        )}
      </button>
      {error ? (
        <span
          className={[
            "text-xs text-warn",
            variant === "icon" ? "mt-1 max-w-[9rem] text-center" : "max-w-[14rem]",
          ].join(" ")}
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function MarkLeadDoneButton({
  callId,
  disabled = false,
  variant = "default",
}: {
  callId: string;
  disabled?: boolean;
  variant?: "default" | "icon";
}) {
  return (
    <MarkLeadActionButton
      callId={callId}
      action="resolved"
      disabled={disabled}
      variant={variant}
    />
  );
}

export function MarkLeadArchiveButton({
  callId,
  disabled = false,
  variant = "default",
}: {
  callId: string;
  disabled?: boolean;
  variant?: "default" | "icon";
}) {
  return (
    <MarkLeadActionButton
      callId={callId}
      action="archived"
      disabled={disabled}
      variant={variant}
    />
  );
}
