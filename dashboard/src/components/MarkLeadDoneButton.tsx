"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { btnGhost, deskShiftClass } from "@/components/ui/deskChrome";

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
 * Archive = archived (leaves Needs you, All, Visits, Holds, Human, Answered; sits on Archived).
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
  variant?: "default" | "icon" | "button";
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
    if (variant === "button") {
      return (
        <span className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-ok-soft text-sm font-semibold text-ok">
          {successLabel}
        </span>
      );
    }
    return <span className="text-xs font-medium text-ok">{successLabel}</span>;
  }

  const iconButtonClass =
    `inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft ${deskShiftClass} hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50`;
  const chromeButtonClass = `${btnGhost} w-full gap-2`;
  const linkButtonClass =
    `text-xs font-medium text-ink-soft underline-offset-2 ${deskShiftClass} hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50`;

  return (
    <span
      className={
        variant === "icon"
          ? "inline-flex flex-col items-center"
          : variant === "button"
            ? "flex w-full flex-col items-stretch gap-1"
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
              setError(res.error || (action === "archived" ? "Could not archive." : "Could not mark done."));
              return;
            }
            setDone(true);
            router.refresh();
          });
        }}
        className={
          variant === "icon"
            ? iconButtonClass
            : variant === "button"
              ? chromeButtonClass
              : linkButtonClass
        }
      >
        {variant === "icon" ? (
          action === "archived" ? (
            <ArchiveGlyph className="h-4 w-4" />
          ) : (
            <DoneGlyph className="h-4 w-4" />
          )
        ) : variant === "button" ? (
          <>
            {action === "archived" ? (
              <ArchiveGlyph className="h-4 w-4" />
            ) : (
              <DoneGlyph className="h-4 w-4" />
            )}
            {pending ? busyLabel : label}
          </>
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
            variant === "icon"
              ? "mt-1 max-w-[9rem] text-center"
              : variant === "button"
                ? "text-center"
                : "max-w-[14rem]",
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
  variant?: "default" | "icon" | "button";
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
  variant?: "default" | "icon" | "button";
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
