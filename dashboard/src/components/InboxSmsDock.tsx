"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { PaperAirplaneIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import {
  polishInboxSmsAction,
  sendInboxReplySms,
  type PolishCallerNoteState,
  type SendCallerNoteState,
} from "@/app/(desk)/calls/noteActions";
import { IconButton } from "@/components/ui/IconButton";
import { deskShiftClass } from "@/components/ui/deskChrome";
import type { InboxSmsFacts } from "@/lib/polishInboxSms";
import { emptyInboxSmsFacts } from "@/lib/polishInboxSms";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

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
          className={`min-h-11 max-h-40 w-full resize-none rounded-xl border border-hairline bg-surface px-3 py-2.5 text-body text-ink ${deskShiftClass} placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand`}
        />
        {callerPhone ? (
          <IconButton
            type="button"
            label={wandLabel}
            size="sm"
            pending={polishPending}
            disabled={polishPending || sendPending}
            onClick={() => {
              if (polishPending || sendPending) return;
              const fd = new FormData();
              fillPolishForm(fd);
              startTransition(() => {
                polishAction(fd);
              });
            }}
          >
            <PencilSquareIcon aria-hidden="true" />
          </IconButton>
        ) : null}
        <IconButton
          type="submit"
          label="Send"
          size="sm"
          tone="accent"
          pending={sendPending}
          disabled={sendPending || !canSend}
        >
          <PaperAirplaneIcon aria-hidden="true" />
        </IconButton>
      </form>
      {polishState.error ? (
        <p className="mt-1 text-caption text-attention" role="status">
          {polishState.error}
        </p>
      ) : null}
      {sendState.error ? (
        <p className="mt-1 text-caption text-attention" role="alert">
          {sendState.error}
        </p>
      ) : null}
      {sendState.ok ? (
        <p className="mt-1 text-caption text-ok" role="status">
          Sent
        </p>
      ) : null}
    </div>
  );
}
