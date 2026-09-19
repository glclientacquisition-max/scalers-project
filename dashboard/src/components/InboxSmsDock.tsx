"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  polishInboxSmsAction,
  sendInboxReplySms,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import {
  btnPrimary,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

function WandGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M15 4.5 5.5 14 4 20l6-1.5 9.5-9.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.8 6.2 17.8 10.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M16.5 3.2v2.6M15.2 4.5h2.6M20 9.2v2M19 10.2h2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
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
  const [polishState, polishAction, polishPending] = useActionState(
    polishInboxSmsAction,
    polishInitial
  );
  const [sendState, sendAction, sendPending] = useActionState(
    sendInboxReplySms,
    sendInitial
  );

  useEffect(() => {
    if (polishState.text) setNote(polishState.text);
  }, [polishState.text]);

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
        {callerPhone ? (
          <button
            type="button"
            aria-label="Polish"
            title="Polish"
            aria-busy={polishPending}
            disabled={polishPending || sendPending || !note.trim()}
            className={`${deskHitClass} ${deskShiftClass} text-ink-soft hover:bg-surface-muted hover:text-ink ${focusRingVisible} disabled:opacity-50`}
            onClick={() => {
              if (!note.trim() || polishPending || sendPending) return;
              const fd = new FormData();
              fd.set("note", note);
              polishAction(fd);
            }}
          >
            {polishPending ? (
              <span aria-hidden="true" className={pendingSpinnerInkClass} />
            ) : (
              <WandGlyph />
            )}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={sendPending || !canSend}
          className={`${btnPrimary} h-12 min-w-12 shrink-0 px-4`}
        >
          {sendPending ? "Sending" : "Send"}
        </button>
      </form>
      <p className="mt-1.5 text-xs text-ink-soft">WhatsApp uses the icon above.</p>
      {polishState.error ? (
        <p className="mt-1 text-xs text-warn" role="status">
          {polishState.error}
        </p>
      ) : null}
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
