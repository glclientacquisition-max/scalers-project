"use client";

import { useActionState, useEffect, useState } from "react";
import {
  polishCallerNoteAction,
  sendCallerNoteAction,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { btnGhost, btnPrimary } from "@/components/ui/deskChrome";
import { canDraftCallerNote } from "@/lib/polishCallerNote";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none transition duration-150 placeholder:text-ink-soft/70 hover:border-accent/35 focus:outline-none focus:ring-2 focus:ring-accent";

export function CallerNoteComposer({
  callId,
  callerPhone,
  callerName,
  service,
  when,
  landmark,
  purpose,
  callerSmsOn,
  waDefault = "",
  showWhatsApp = false,
  primary = false,
  waPrimary = false,
}: {
  callId: string;
  callerPhone: string | null;
  callerName: string | null;
  service?: string | null;
  when?: string | null;
  landmark?: string | null;
  purpose?: string | null;
  callerSmsOn: boolean;
  waDefault?: string;
  showWhatsApp?: boolean;
  primary?: boolean;
  waPrimary?: boolean;
}) {
  const [note, setNote] = useState("");
  const [polishState, polishAction, polishPending] = useActionState(
    polishCallerNoteAction,
    polishInitial
  );
  const [sendState, sendAction, sendPending] = useActionState(
    sendCallerNoteAction,
    sendInitial
  );

  useEffect(() => {
    if (polishState.text) setNote(polishState.text);
  }, [polishState.text]);

  const canDraft = canDraftCallerNote({ purpose });
  const canPolish = Boolean(note.trim()) || canDraft;
  const canSend = callerSmsOn && Boolean(callerPhone) && note.trim().length > 0;
  const waBody = note.trim() || waDefault;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Reply</p>
      <form action={polishAction}>
        <input type="hidden" name="caller_name" value={callerName || ""} />
        <input type="hidden" name="service" value={service || ""} />
        <input type="hidden" name="when" value={when || ""} />
        <input type="hidden" name="landmark" value={landmark || ""} />
        <input type="hidden" name="purpose" value={purpose || ""} />
        <textarea
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Tuesday 2pm instead"
          className={fieldClass}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={polishPending || !canPolish}
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-ink-soft transition duration-150 hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            Polish
          </button>
        </div>
      </form>
      <div className="flex flex-col gap-2">
        {callerSmsOn ? (
          <form action={sendAction} className="flex items-center gap-2">
            <input type="hidden" name="call_id" value={callId} />
            <input type="hidden" name="caller_phone" value={callerPhone || ""} />
            <input type="hidden" name="note" value={note} />
            <button
              type="submit"
              disabled={sendPending || !canSend}
              className={
                primary ? `${btnPrimary} flex-1` : `${btnGhost} flex-1 disabled:opacity-60`
              }
            >
              {sendPending ? "Sending" : "Send SMS"}
            </button>
          </form>
        ) : null}
        {showWhatsApp && callerPhone ? (
          <WhatsAppLink
            number={callerPhone}
            message={waBody}
            variant={waPrimary ? "primary" : "link"}
            label="Reply on WhatsApp"
            className="w-full"
          />
        ) : null}
      </div>
      {polishState.error ? <p className="text-sm text-warn">{polishState.error}</p> : null}
      {sendState.error ? <p className="text-sm text-warn">{sendState.error}</p> : null}
      {sendState.ok ? <p className="text-sm text-ok">Sent</p> : null}
    </div>
  );
}
