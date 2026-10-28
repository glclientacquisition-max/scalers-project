"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { retryCallTextAction } from "@/app/(desk)/calls/textThreadActions";
import type { CallMessage } from "@/lib/callMessages";
import {
  textBubbleTime,
  textThreadBubbles,
  textThreadEmpty,
  type TextBubble,
} from "@/lib/callTextThread";
import { pendingSpinnerInkClass } from "@/components/ui/deskChrome";
import {
  addPendingText,
  dropPendingTexts,
  mergePendingTexts,
  pendingTextsFor,
  subscribePendingTexts,
  type PendingText,
} from "@/lib/pendingTexts";
import { deliverPendingText } from "@/lib/pendingTextSend";

const NO_PENDING: PendingText[] = [];

/** Local texts for this call (Sending / Sent / Not sent) until the server has them. */
function usePendingTexts(callId: string): PendingText[] {
  return useSyncExternalStore(
    subscribePendingTexts,
    () => pendingTextsFor(callId),
    () => NO_PENDING
  );
}

/** One tick (sent) or two (delivered). Inline glyph like JumpGlyph; no new icon set. */
function Ticks({ n }: { n: 1 | 2 }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      {n === 2 ? (
        <path
          d="m2.5 12.5 4 4 8-9M10 15.5l1 1 8-9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function bubbleClass(b: TextBubble): string {
  if (b.failed) return "border-[1.5px] border-attention bg-surface text-ink";
  if (b.tone === "owner") return "bg-accent text-accent-on";
  if (b.tone === "assistant") return "bg-surface-2 text-ink";
  return "bg-bubble-caller text-ink";
}

function stampClass(b: TextBubble): string {
  if (b.failed) return "text-attention";
  if (b.tone === "owner") return "text-accent-on/80";
  return "text-ink-2";
}

function Bubble({
  b,
  callId,
  canAct,
  local = null,
}: {
  b: TextBubble;
  callId: string;
  canAct: boolean;
  /** Set for a text the server has not recorded yet (Retry resends it). */
  local?: PendingText | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const right = b.side === "right";
  const time = textBubbleTime(b.at);
  const sending = b.statusLabel === "Sending";

  function retry() {
    setError(null);
    if (local) {
      // Never left the phone: send the same words again under the same reply
      // id, so a send that did land is not doubled.
      const fd = new FormData();
      fd.set("call_id", local.callId);
      fd.set("caller_phone", local.callerPhone);
      fd.set("reply_id", local.id);
      fd.set("note", local.body);
      addPendingText({ id: local.id, callId: local.callId, callerPhone: local.callerPhone, body: local.body, at: Date.now() });
      void deliverPendingText(local.id, fd);
      return;
    }
    start(async () => {
      const res = await retryCallTextAction(callId, b.id);
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div data-text-bubble={b.tone} className={["mt-3 flex px-1", right ? "justify-end" : "justify-start"].join(" ")}>
      <div
        role="group"
        aria-label={b.label || (b.tone === "caller" ? "Caller" : "You")}
        className={[
          "max-w-[85%] px-3 py-2 sm:max-w-[75%]",
          right ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-bl-md",
          bubbleClass(b),
          sending ? "opacity-75" : "",
        ].join(" ")}
      >
        {b.label ? <p className="mb-0.5 text-right text-caption font-medium text-ink-2">{b.label}</p> : null}
        <p className="whitespace-pre-wrap text-body leading-relaxed [overflow-wrap:anywhere]">{b.body}</p>
        <p
          data-text-status={b.statusLabel || undefined}
          className={[
            "mt-1 flex flex-wrap items-center gap-1.5 text-caption",
            right ? "justify-end" : "justify-start",
            stampClass(b),
          ].join(" ")}
        >
          {b.failed ? <ExclamationCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {b.failed ? (
            <span>
              {local ? "Not sent." : "Not delivered."}
              {b.reason ? ` ${b.reason}` : ""}
            </span>
          ) : (
            <span>
              {[b.tone === "owner" ? "You" : null, time, b.statusLabel].filter(Boolean).join(" · ")}
            </span>
          )}
          {b.ticks ? <Ticks n={b.ticks as 1 | 2} /> : null}
          {sending ? <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {b.failed && b.canRetry && canAct ? (
            <button
              type="button"
              onClick={retry}
              disabled={pending}
              className="inline-flex min-h-6 items-center gap-1 font-semibold text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              {pending ? <span className={pendingSpinnerInkClass} aria-hidden="true" /> : null}
              {pending ? "Retrying" : "Retry"}
            </button>
          ) : null}
        </p>
        {error ? (
          <p className="mt-1 text-right text-caption text-attention" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Texts tab of the call view: the call's SMS thread, oldest first. */
export function CallTextThread({
  callId,
  callerName,
  messages,
  canAct,
}: {
  callId: string;
  callerName: string | null;
  messages: CallMessage[];
  /** Member may send (inbox.act): shows Retry. */
  canAct: boolean;
}) {
  const pending = usePendingTexts(callId);
  const { bubbles, matched } = mergePendingTexts(messages, textThreadBubbles(messages), pending);
  const matchedKey = matched.join(",");
  useEffect(() => {
    // The server row is in: drop the local copy.
    if (matchedKey) dropPendingTexts(matchedKey.split(","));
  }, [matchedKey]);
  const localById = new Map(pending.map((p) => [`local:${p.id}`, p]));
  if (!bubbles.length) {
    return (
      <p data-text-empty="" className="px-3 py-10 text-center text-body text-ink-2">
        {textThreadEmpty(callerName)}
      </p>
    );
  }
  return (
    <div data-text-thread="" className="flex flex-col">
      {bubbles.map((b) => (
        <Bubble key={b.id} b={b} callId={callId} canAct={canAct} local={localById.get(b.id) ?? null} />
      ))}
    </div>
  );
}
