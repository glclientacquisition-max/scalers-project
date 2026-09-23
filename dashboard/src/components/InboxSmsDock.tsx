"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import {
  polishInboxSmsAction,
  sendInboxReplySms,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { DeskHint } from "@/components/ui/DeskHint";
import {
  btnPrimaryFill,
  deskHitClass,
  deskShiftClass,
  focusRingVisible,
  pendingSpinnerClass,
  pendingSpinnerInkClass,
} from "@/components/ui/deskChrome";
import type { InboxSmsFacts } from "@/lib/polishInboxSms";
import { emptyInboxSmsFacts } from "@/lib/polishInboxSms";

const polishInitial: PolishCallerNoteState = {};
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
  facts = emptyInboxSmsFacts(),
}: {
  callId: string;
  callerPhone: string | null;
  facts?: InboxSmsFacts;
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
  const wandLabel = note.trim() ? "Polish" : "Suggest";

  function fillPolishForm(fd: FormData) {
    fd.set("note", note);
    fd.set("business_name", facts.businessName);
    fd.set("caller_name", facts.callerName);
    fd.set("want", facts.want);
    fd.set("purpose", facts.purpose);
    fd.set("job_status", facts.jobStatus);
    fd.set("job_service", facts.jobService);
    fd.set("job_when", facts.jobWhen);
    fd.set("job_place", facts.jobPlace);
    fd.set("hold_status", facts.holdStatus);
    fd.set("hold_type", facts.holdType);
    fd.set("hold_item", facts.holdItem);
    fd.set("hold_when", facts.holdWhen);
    fd.set("standing", facts.standing);
  }

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
          <DeskHint label={wandLabel} side="top">
            <button
              type="button"
              aria-label={wandLabel}
              title={wandLabel}
              aria-busy={polishPending}
              disabled={polishPending || sendPending}
              className={`${deskHitClass} ${deskShiftClass} text-ink-soft hover:bg-surface-muted hover:text-ink ${focusRingVisible} disabled:opacity-50`}
              onClick={() => {
                if (polishPending || sendPending) return;
                const fd = new FormData();
                fillPolishForm(fd);
                startTransition(() => {
                  polishAction(fd);
                });
              }}
            >
              {polishPending ? (
                <span aria-hidden="true" className={pendingSpinnerInkClass} />
              ) : (
                <WandGlyph />
              )}
            </button>
          </DeskHint>
        ) : null}
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
