"use client";

import { useRef } from "react";
import { CallLink } from "@/components/CallLink";
import { CallerNoteComposer } from "@/components/CallerNoteComposer";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { btnGhost } from "@/components/ui/deskChrome";
import type { InboxItem } from "@/lib/inboxPurpose";

function SmsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
      <path d="M4.5 5.25A1.75 1.75 0 0 1 6.25 3.5h11.5A1.75 1.75 0 0 1 19.5 5.25v8.5a1.75 1.75 0 0 1-1.75 1.75H9.06L5.2 18.72A.75.75 0 0 1 4 18.12V5.25Z" />
    </svg>
  );
}

export function InboxReplyDock({
  item,
  message,
  callerSmsOn,
  showCall = true,
  showWhatsApp = true,
}: {
  item: InboxItem;
  message: string;
  callerSmsOn: boolean;
  showCall?: boolean;
  showWhatsApp?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const phone = item.callerPhone;
  if (!phone) return null;

  const callId = item.callId || "";
  const showSms = callerSmsOn && Boolean(callId);

  return (
    <div
      className="flex items-center gap-2"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {showCall ? <CallLink number={phone} /> : null}
      {showSms ? (
        <>
          <button
            type="button"
            title="SMS"
            aria-label={`SMS ${phone}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink transition hover:border-accent hover:text-accent-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            onClick={() => dialogRef.current?.showModal()}
          >
            <SmsIcon />
          </button>
          <dialog
            ref={dialogRef}
            className="w-[min(calc(100vw-2rem),28rem)] rounded-2xl border border-line bg-surface p-4 text-ink shadow-lg backdrop:bg-ink/40"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{item.callerName || phone}</p>
              <form method="dialog">
                <button type="submit" className={btnGhost}>
                  Close
                </button>
              </form>
            </div>
            <CallerNoteComposer
              callId={callId}
              callerPhone={phone}
              callerName={item.callerName}
              service={item.job?.service_name || item.hold?.item}
              when={item.job?.when_text || item.hold?.when_text}
              landmark={item.job?.address_landmark}
              purpose={item.purpose}
              callerSmsOn={callerSmsOn}
              waDefault={message}
              primary
            />
          </dialog>
        </>
      ) : null}
      {showWhatsApp ? (
        <WhatsAppLink number={phone} message={message} variant="icon" />
      ) : null}
    </div>
  );
}
