"use client";

import { withRoleGate } from "@/components/DeskRole";
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
import { smsSegments } from "@/lib/smsSegments";
import { composerPlaceholder, composerLabel, smsMeterLine } from "@/lib/callTextThread";
import { addPendingText } from "@/lib/pendingTexts";
import { deliverPendingText } from "@/lib/pendingTextSend";

const polishInitial: PolishCallerNoteState = {};
const sendInitial: SendCallerNoteState = {};

function InboxSmsDockInner({
  callId,
  callerPhone,
  facts = emptyInboxSmsFacts(),
  smsAllowance = null,
  callerName = null,
  onSent,
}: {
  callId: string;
  callerPhone: string | null;
  facts?: InboxSmsFacts;
  /** Package SMS (business row): shows "1 SMS · N of M included left". */
  smsAllowance?: { included: number | null; used: number | null } | null;
  /** For the placeholder: "Text Chris". */
  callerName?: string | null;
  /** Send was tapped (call view switches to Texts, where the Sending bubble shows). */
  onSent?: () => void;
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

  // With a Texts thread (onSent set) the text shows there at once as a
  // Sending bubble and flips to Sent or Not sent. Without one, the old
  // status line under the composer stays.
  const threaded = Boolean(onSent);
  function send() {
    const body = note.trim();
    if (!callerPhone || !body || sendPending) return;
    const id = replyId;
    const fd = new FormData();
    fd.set("call_id", callId);
    fd.set("caller_phone", callerPhone);
    fd.set("reply_id", id);
    fd.set("note", note);
    if (threaded) {
      addPendingText({ id, callId, callerPhone, body, at: Date.now() });
      setNote("");
      setReplyId(crypto.randomUUID());
      if (areaRef.current) areaRef.current.style.height = "";
      onSent?.();
      void deliverPendingText(id, fd);
      return;
    }
    startTransition(() => {
      sendAction(fd);
    });
  }

  useEffect(() => {
    if (threaded || !sendState.ok) return;
    setNote("");
    setReplyId(crypto.randomUUID());
    if (areaRef.current) {
      areaRef.current.style.height = "";
    }
  }, [threaded, sendState.ok, sendState.token]);

  const canSend = Boolean(callerPhone) && note.trim().length > 0;
  const meter = smsAllowance
    ? smsMeterLine({
        segments: smsSegments(note.trim()) || 1,
        included: smsAllowance.included,
        used: smsAllowance.used,
      })
    : null;
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
    <div className="shrink-0 border-t border-hairline bg-surface px-4 py-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="inbox-sms">
          {composerLabel(callerName)}
        </label>
        <textarea
          ref={areaRef}
          id="inbox-sms"
          name="note"
          value={note}
          rows={2}
          placeholder={composerPlaceholder(callerName)}
          aria-describedby={meter && callerPhone ? "inbox-sms-meter" : undefined}
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
          pending={sendPending && !threaded}
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
      {sendState.error && !threaded ? (
        <p className="mt-1 text-caption text-attention" role="alert">
          {sendState.error}
        </p>
      ) : null}
      {sendState.ok && !threaded ? (
        <p className="mt-1 text-caption text-ok" role="status">
          Sent
        </p>
      ) : null}
      {meter && callerPhone ? (
        <p id="inbox-sms-meter" data-sms-meter="" className="mt-1 text-right text-caption tabular-nums text-ink-2">
          {meter}
        </p>
      ) : null}
    </div>
  );
}

export const InboxSmsDock = withRoleGate("inbox.act", InboxSmsDockInner);
