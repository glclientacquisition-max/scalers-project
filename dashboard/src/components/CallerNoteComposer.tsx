"use client";

import { useActionState, useEffect, useState } from "react";
import {
  polishCallerNoteAction,
  sendCallerNoteAction,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

const fieldClass =
  "w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm outline-none transition duration-150 hover:border-[#0096FF]/35 focus:border-[#0096FF] focus:outline-none focus:ring-2 focus:ring-[#0096FF]";

export function CallerNoteComposer({
  callId,
  callerPhone,
  callerName,
  service,
  when,
  landmark,
  callerSmsOn,
}: {
  callId: string;
  callerPhone: string | null;
  callerName: string | null;
  service?: string | null;
  when?: string | null;
  landmark?: string | null;
  callerSmsOn: boolean;
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

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Note</p>
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
            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-ink-soft transition duration-150 hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] disabled:opacity-50"
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
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#0096FF] px-4 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)] transition duration-150 hover:bg-[#0088e8] active:bg-[#007ad1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {sendPending ? "Sending" : "Send"}
        </button>
      </form>
      {polishState.error ? <p className="text-sm text-warn">{polishState.error}</p> : null}
      {sendState.error ? <p className="text-sm text-warn">{sendState.error}</p> : null}
      {sendState.ok ? <p className="text-sm text-ok">Sent</p> : null}
    </div>
  );
}
