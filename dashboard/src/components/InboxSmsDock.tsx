"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  sendInboxReplySms,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  btnPrimaryFill,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
} from "@/components/ui/deskChrome";

const sendInitial: SendCallerNoteState = {};

function SendGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M22 2 11 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 2 15 22l-4-9-9-4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [note]);

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
        <label className="sr-only" htmlFor="inbox-sms">
          SMS
        </label>
        <textarea
          ref={areaRef}
          id="inbox-sms"
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
        <DeskHint label="Send" side="top">
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            aria-busy={sendPending}
            disabled={sendPending || !canSend}
            className={`inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl ${btnPrimaryFill} ${deskShiftClass} active:scale-[0.99] motion-reduce:active:scale-100 ${focusRingVisible}`}
          >
            {sendPending ? (
              <span aria-hidden="true" className={pendingSpinnerClass} />
            ) : (
              <SendGlyph />
            )}
          </button>
        </DeskHint>
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
