/**
 * Turn an owner scratch note into one customer SMS.
 */

export type PolishCallerNoteInput = {
  note: string;
  businessName: string;
  callerName?: string | null;
  service?: string | null;
  when?: string | null;
  landmark?: string | null;
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

export function fallbackPolishCallerNote(input: PolishCallerNoteInput): string {
  const business = String(input.businessName || "").trim() || "We";
  const name = cleanCallerFirstName(input.callerName);
  const hi = name ? `Hi ${name}, ` : "Hi, ";
  const note = String(input.note || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  const body = note || "The team will follow up.";
  return `${hi}${business} here. ${body}`.slice(0, 320);
}

export function stripModelSms(raw: string): string {
  return String(raw || "")
    .replace(/^```[\w]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export const POLISH_CALLER_SMS_SYSTEM = `Rewrite the owner's rough note as one SMS to their customer.
Return only the SMS body. No quotes. No markdown. Max 320 characters.
Start with Hi {Name}, {Business} here. when a real first name is given. Otherwise Hi, {Business} here.
Keep the owner's intent. Do not add marketing, transcripts, recordings, or staff directory.
Do not invent a time, service, or place that is not in the note or the facts.`;
