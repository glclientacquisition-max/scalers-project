/**
 * Turn an owner scratch note into one customer SMS.
 * Empty note: draft from saved call facts. Never invent a next step.
 */

import { renderCallerTemplate } from "./messageTemplates.ts";

export type CallerReplyPurpose = "missed" | "human" | "job" | "hold" | "answered" | "";

export type PolishCallerNoteInput = {
  note: string;
  businessName: string;
  callerName?: string | null;
  service?: string | null;
  when?: string | null;
  landmark?: string | null;
  purpose?: CallerReplyPurpose | string | null;
};

const BLOCKED = new Set([
  "calling",
  "callings",
  "haijawekwa",
  "caller",
  "customer",
  "unknown",
]);

export function cleanCallerFirstName(raw: string | null | undefined): string {
  const name = String(raw || "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  if (!name || BLOCKED.has(name.toLowerCase())) return "";
  return name;
}

export function callerReplyPurpose(
  raw: string | null | undefined
): CallerReplyPurpose {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (key === "missed" || key === "human" || key === "job" || key === "hold" || key === "answered") {
    return key;
  }
  return "";
}

export function canDraftCallerNote(input: {
  purpose?: string | null;
}): boolean {
  const purpose = callerReplyPurpose(input.purpose);
  return purpose === "missed" || purpose === "human" || purpose === "job" || purpose === "hold";
}

export function fallbackPolishCallerNote(input: PolishCallerNoteInput): string {
  const note = String(input.note || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  if (note) {
    const business = String(input.businessName || "").trim() || "We";
    const name = cleanCallerFirstName(input.callerName);
    const hi = name ? `Hi ${name}, ` : "Hi, ";
    return `${hi}${business} here. ${note}`.slice(0, 320);
  }
  return draftCallerNoteFromFacts(input);
}

export function draftCallerNoteFromFacts(input: PolishCallerNoteInput): string {
  if (!canDraftCallerNote(input)) return "";
  const purpose = callerReplyPurpose(input.purpose);
  const businessName = String(input.businessName || "").trim() || "We";
  const callerName = cleanCallerFirstName(input.callerName);
  const item = String(input.service || "").trim();
  const when = String(input.when || "").trim();
  if (purpose === "job") {
    return renderCallerTemplate({
      kind: "caller_appointment",
      businessName,
      callerName,
      item,
      when,
    }).slice(0, 320);
  }
  if (purpose === "hold") {
    return renderCallerTemplate({
      kind: "caller_hold",
      businessName,
      callerName,
      item,
      when,
    }).slice(0, 320);
  }
  return renderCallerTemplate({
    kind: "caller_callback",
    businessName,
    callerName,
  }).slice(0, 320);
}

export function stripModelSms(raw: string): string {
  const text = String(raw || "")
    .replace(/^```[\w]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^NOTHING_TO_SEND$/i.test(text)) return "";
  return text.slice(0, 320);
}

export const POLISH_CALLER_SMS_SYSTEM = `Rewrite the owner's rough note as one SMS to their customer.
If the owner note is empty, draft one SMS from the facts only (visit, hold, missed, or human callback).
If there is no visit, hold, missed call, or human callback to act on, return NOTHING_TO_SEND.
Return only the SMS body. No quotes. No markdown. Max 320 characters.
Start with Hi {Name}, {Business} here. when a real first name is given. Otherwise Hi, {Business} here.
Keep the owner's intent. Do not add marketing, transcripts, recordings, or staff directory.
Do not invent a time, service, or place that is not in the note or the facts.`;
