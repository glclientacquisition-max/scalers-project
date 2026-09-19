"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  sendInboxReplySms,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { btnPrimary, deskShiftClass } from "@/components/ui/deskChrome";

const sendInitial: SendCallerNoteState = {};

export function InboxSmsDock({
  callId,
  callerPhone,
}: {
  callId: string;
  callerPhone: string | null;
}) {
  const [note, setNote] = useState("");
  const [replyId, setReplyId] = useState(() => crypto.randomUUID());
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [sendState, sendAction, sendPending] = useActionState(
    sendInboxReplySms,
    sendInitial
  );

  useEffect(() => {
    if (sendState.ok) {
      setNote("");
      setReplyId(crypto.randomUUID());
      if (areaRef.current) {
        areaRef.current.style.height = "";
      }
    }
  }, [sendState.ok, sendState.token]);

  const canSend = Boolean(callerPhone) && note.trim().length > 0;

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
      <form action={sendAction} className="flex items-end gap-2">
        <input type="hidden" name="call_id" value={callId} />
        <input type="hidden" name="caller_phone" value={callerPhone || ""} />
        <input type="hidden" name="reply_id" value={replyId} />
        <label className="sr-only" htmlFor={`inbox-sms-${callId}`}>
          SMS
        </label>
        <textarea
          ref={areaRef}
          id={`inbox-sms-${callId}`}
          name="note"
          value={note}
          rows={2}
          placeholder="SMS"
          onChange={(event) => {
            setNote(event.target.value);
            const el = event.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          className={`min-h-11 max-h-40 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink ${deskShiftClass} placeholder:text-ink-soft/70 focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
        />
        <button
          type="submit"
          disabled={sendPending || !canSend}
          className={`${btnPrimary} h-12 min-w-12 shrink-0 px-4`}
        >
          {sendPending ? "Sending" : "Send"}
        </button>
      </form>
      <p className="mt-1.5 text-xs text-ink-soft">WhatsApp uses the icon above.</p>
      {sendState.error ? (
        <p className="mt-1 text-xs text-warn" role="alert">
          {sendState.error}
        </p>
      ) : null}
      {sendState.ok ? (
        <p className="mt-1 text-xs text-ok" role="status">
          Sent
        </p>
      ) : null}
    </div>
  );
}
