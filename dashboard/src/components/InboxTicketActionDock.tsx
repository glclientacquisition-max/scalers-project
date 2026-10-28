"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import { updateLeadStatus } from "@/app/(desk)/calls/actions";
import { CallLink } from "@/components/CallLink";
import { InboxPingTeammate, type InboxPingPerson } from "@/components/InboxPingTeammate";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { IconButton } from "@/components/ui/IconButton";
import { notify } from "@/components/ui/DeskNotice";
import { OPTIMISTIC_OFFLINE_ERROR } from "@/lib/optimisticAction";

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
  const [done, setDone] = useState(false);
  // Reads Done the moment it is tapped. React drops the optimistic value if
  // the transition ends without setDone(true), so a failed save rolls back.
  const [shownDone, showDone] = useOptimistic(done, (_current, next: boolean) => next);
  const [, startTransition] = useTransition();
  const name = shownDone ? "Done" : "Mark done";

  function markDone() {
    if (shownDone) return;
    startTransition(async () => {
      showDone(true);
      let res: { ok?: boolean; error?: string };
      try {
        res = await updateLeadStatus(callId, "resolved");
      } catch {
        res = { error: OPTIMISTIC_OFFLINE_ERROR };
      }
      if (!res.ok) {
        notify(res.error || "Could not mark done.", {
          tone: "error",
          action: { label: "Try again", run: markDone },
        });
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <DockSlot label="Done">
      <IconButton
        label={name}
        size="sm"
        tone={shownDone ? "ok" : "neutral"}
        disabled={shownDone}
        onClick={markDone}
      >
        <CheckIcon aria-hidden="true" />
      </IconButton>
    </DockSlot>
  );
}

function InboxTicketActionDockInner({
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

export const InboxTicketActionDock = withRoleGate("inbox.act", InboxTicketActionDockInner);
