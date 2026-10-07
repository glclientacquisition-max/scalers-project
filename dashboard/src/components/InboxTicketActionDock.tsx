"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { CallLink } from "@/components/CallLink";
import { InboxPingTeammate, type InboxPingPerson } from "@/components/InboxPingTeammate";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { IconButton } from "@/components/ui/IconButton";

function DockSlot({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      {children}
      <span className="text-caption font-medium leading-none text-ink-2">{label}</span>
    </div>
  );
}

function DockMarkDone({ callId }: { callId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const name = pending ? "Saving" : done ? "Done" : "Mark done";

  return (
    <DockSlot label="Done">
      <IconButton
        label={name}
        size="sm"
        tone={done ? "ok" : "neutral"}
        pending={pending}
        disabled={pending || done}
        onClick={() => {
          if (pending || done) return;
          setError(null);
          setPending(true);
          void (async () => {
            const res = await updateLeadStatus(callId, "resolved");
            setPending(false);
            if (!res.ok) {
              setError(res.error || "Could not mark done.");
              return;
            }
            setDone(true);
            router.refresh();
          })();
        }}
      >
        <CheckIcon aria-hidden="true" />
      </IconButton>
      {error ? (
        <span className="max-w-[6.5rem] text-center text-caption text-attention" role="alert">
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
      className="shrink-0 border-t border-hairline bg-surface px-4 py-2"
    >
      <div className="flex items-start justify-center gap-3">
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
