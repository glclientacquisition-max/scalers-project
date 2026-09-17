"use client";

import { useActionState, useEffect, useState } from "react";
import {
  polishCallerNoteAction,
  sendCallerNoteAction,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { btnGhost, btnPrimary, deskShiftClass } from "@/components/ui/deskChrome";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

const fieldClass =
  `w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none ${deskShiftClass} placeholder:text-ink-soft/70 hover:border-accent/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent`;

export function CallerNoteComposer({
  callId,
  callerPhone,
  callerName,
  service,
  when,
  landmark,
  callerSmsOn,
  primary = false,
}: {
  callId: string;
  callerPhone: string | null;
  callerName: string | null;
  service?: string | null;
  when?: string | null;
  landmark?: string | null;
  callerSmsOn: boolean;
  primary?: boolean;
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

  const canSend = callerSmsOn && Boolean(callerPhone) && note.trim().length > 0;
  if (!callerSmsOn) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">SMS</p>
      <form action={polishAction}>
        <input type="hidden" name="caller_name" value={callerName || ""} />
        <input type="hidden" name="service" value={service || ""} />
        <input type="hidden" name="when" value={when || ""} />
        <input type="hidden" name="landmark" value={landmark || ""} />
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
            disabled={polishPending || !note.trim()}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-ink-soft ${deskShiftClass} hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50`}
          >
            Polish
          </button>
        </div>
      </form>
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
      {polishState.error ? <p className="text-sm text-warn">{polishState.error}</p> : null}
      {sendState.error ? <p className="text-sm text-warn">{sendState.error}</p> : null}
      {sendState.ok ? <p className="text-sm text-ok">Sent</p> : null}
    </div>
  );
}
