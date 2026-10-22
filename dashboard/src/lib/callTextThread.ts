/**
 * Call view Texts tab: pure view model (client safe). Data: lib/callMessages.ts.
 */
import type { CallMessage } from "@/lib/callMessages";

export type CallViewTab = "call" | "texts";

/** ?tab=texts opens Texts when the thread exists. Default is Call (no inbound yet). */
export function callViewTab(param: string | null | undefined, available: boolean): CallViewTab {
  if (!available) return "call";
  return String(param || "").trim().toLowerCase() === "texts" ? "texts" : "call";
}

export type BubbleTone = "owner" | "assistant" | "caller";

export type TextBubble = {
  id: string;
  side: "left" | "right";
  tone: BubbleTone;
  /** Shown above the body. Only the Business Assistant is labelled. */
  label: string | null;
  body: string;
  /** "Sending", "Sent", "Delivered", "Not delivered" or null (inbound). */
  statusLabel: string | null;
  ticks: 0 | 1 | 2;
  failed: boolean;
  reason: string | null;
  canRetry: boolean;
  at: string;
};

/** Owner words for notify_sends.failure_reason values. */
export function textFailureReason(raw: string | null | undefined): string | null {
  const r = String(raw || "").trim().toLowerCase();
  if (!r) return null;
  if (r === "no_caller_phone") return "No valid number.";
  if (r === "sms_allowance_exhausted" || r === "allowance_exhausted") return "Included SMS used.";
  if (r === "sms_not_configured") return "Texting is not set up for this business yet.";
  if (r === "line_paused" || r === "line_closed" || r.includes("paused")) return "Line is paused.";
  if (r.startsWith("textsms_")) return "Text service error.";
  return "Send failed.";
}

export function textBubble(m: CallMessage): TextBubble {
  const inbound = m.direction === "in";
  const assistant = !inbound && (m.authorKind === "assistant" || m.authorKind === "system");
  const failed = !inbound && (m.status === "failed" || m.status === "refused");
  const statusLabel = inbound
    ? null
    : failed
      ? "Not delivered"
      : m.status === "delivered"
        ? "Delivered"
        : m.status === "sent"
          ? "Sent"
          : "Sending";
  return {
    id: m.id,
    side: inbound ? "left" : "right",
    tone: inbound ? "caller" : assistant ? "assistant" : "owner",
    label: assistant ? "Business Assistant" : null,
    body: m.body,
    statusLabel,
    ticks: m.status === "delivered" ? 2 : m.status === "sent" ? 1 : 0,
    failed,
    reason: failed ? textFailureReason(m.failureReason) : null,
    // Not set up: a retry fails the same way, so no Retry.
    canRetry: failed && String(m.failureReason || "").trim().toLowerCase() !== "sms_not_configured",
    at: m.sentAt || m.createdAt,
  };
}

/** Thread bubbles. A failed text that was retried shows only as its retry. */
export function textThreadBubbles(messages: CallMessage[]): TextBubble[] {
  const retried = new Set(messages.map((m) => m.retryOf).filter((id): id is string => Boolean(id)));
  return messages.filter((m) => !retried.has(m.id)).map(textBubble);
}

/** Count for the tab: visible thread bubbles. */
export function textThreadCount(messages: CallMessage[]): number {
  return textThreadBubbles(messages).length;
}

/** Composer placeholder: "Text Chris", or "Text caller". */
export function composerPlaceholder(name: string | null | undefined): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first ? `Text ${first}` : "Text caller";
}

export function textThreadEmpty(name: string | null | undefined): string {
  const who = String(name || "").trim() || "this caller";
  return `No texts with ${who} yet. Texts you send here show up in this thread.`;
}

/**
 * Composer meter: "1 SMS · 262 of 300 included left". Null when the business
 * has no included SMS on its package (nothing honest to count down).
 */
export function smsMeterLine(opts: {
  segments: number;
  included: number | null | undefined;
  used: number | null | undefined;
}): string | null {
  const included = Math.max(0, Math.floor(Number(opts.included) || 0));
  if (!included) return null;
  const used = Math.max(0, Math.floor(Number(opts.used) || 0));
  const left = Math.max(0, included - used);
  const parts = Math.max(1, Math.floor(Number(opts.segments) || 0));
  return `${parts} SMS · ${left} of ${included} included left`;
}

/** Clock for a bubble, e.g. "10:02 AM". */
export function textBubbleTime(iso: string, timeZone = "Africa/Nairobi"): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-KE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .format(new Date(ms))
    .replace(/\s?am$/i, " AM")
    .replace(/\s?pm$/i, " PM");
}
