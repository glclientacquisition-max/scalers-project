"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { CallLink } from "@/components/CallLink";
import { InboxPingTeammate, type InboxPingPerson } from "@/components/InboxPingTeammate";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";

function DoneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4 10-10" />
    </svg>
  );
}

function DockSlot({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      {children}
      <span className="text-[11px] font-medium leading-none text-ink-soft">{label}</span>
    </div>
  );
}

function DockMarkDone({ callId }: { callId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const name = pending ? "Saving" : done ? "Done" : "Mark done";

  return (
    <DockSlot label="Done">
      <DeskHint label="Mark done" side="top">
        <button
          type="button"
          disabled={pending || done}
          aria-label={name}
          title={name}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await updateLeadStatus(callId, "resolved");
              if (!res.ok) {
                setError(res.error || "Could not mark done.");
                return;
              }
              setDone(true);
              router.refresh();
            });
          }}
          className={[
            deskHitClass,
            "border border-line bg-surface text-ink",
            deskShiftClass,
            focusRingVisible,
            "hover:border-accent disabled:opacity-50",
            done ? "border-ok/40 bg-ok-soft text-ok" : "",
          ].join(" ")}
        >
          {pending ? (
            <span aria-hidden="true" className={pendingSpinnerInkClass} />
          ) : (
            <DoneGlyph />
          )}
        </button>
      </DeskHint>
      {error ? (
        <span className="max-w-[6.5rem] text-center text-[11px] text-warn" role="alert">
          {error}
        </span>
      ) : null}
    </DockSlot>
  );
}

export function InboxTicketActionDock({
  callId,
  callerPhone,
  waMessage,
  canMarkDone,
  escalatePeople,
  archived,
}: {
  callId: string;
  callerPhone: string | null;
  waMessage: string;
  canMarkDone: boolean;
  escalatePeople: InboxPingPerson[];
  archived: boolean;
}) {
  const showDone = canMarkDone;
  const showReach = Boolean(callerPhone);
  const showPing = !archived && escalatePeople.length > 0;
  if (!showDone && !showReach && !showPing) return null;

  return (
    <nav
      data-ticket-action-dock=""
      aria-label="Call actions"
      className="shrink-0 border-t border-line bg-surface px-4 py-2"
    >
      <div className="flex items-start justify-evenly gap-2">
        {showDone ? <DockMarkDone callId={callId} /> : null}
        {showReach && callerPhone ? (
          <DockSlot label="Call">
            <CallLink number={callerPhone} />
          </DockSlot>
        ) : null}
        {showReach && callerPhone ? (
          <DockSlot label="WhatsApp">
            <WhatsAppLink
              number={callerPhone}
              message={waMessage}
              variant="icon"
              callId={callId}
            />
          </DockSlot>
        ) : null}
        {showPing ? (
          <InboxPingTeammate
            callId={callId}
            people={escalatePeople}
            archived={archived}
            variant="dock"
          />
        ) : null}
      </div>
    </nav>
  );
}
