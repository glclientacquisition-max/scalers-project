/**
 * Scalers-owned caller SMS copy. Keep wording in lockstep with
 * src/notifications/templates.js. Owners do not edit these.
 */

export type CallerTemplateKind =
  | "caller_appointment"
  | "caller_appointment_confirmed"
  | "caller_appointment_cancelled"
  | "caller_appointment_rescheduled"
  | "caller_hold"
  | "caller_hold_updated"
  | "caller_hold_ready"
  | "caller_hold_cancelled"
  | "caller_order"
  | "caller_callback";

function callerHi(name: string): string {
  const who = String(name || "").trim();
  return who ? `Hi ${who}, ` : "Hi, ";
}

function visitWhat(item: string): string {
  const service = String(item || "").trim();
  return service ? `your ${service} visit` : "your visit";
}

function forWhen(when: string): string {
  const slot = String(when || "").trim();
  return slot ? ` for ${slot}` : "";
}

function toWhen(when: string): string {
  const slot = String(when || "").trim();
  return slot ? ` to ${slot}` : "";
}

export function renderCallerTemplate(opts: {
  kind: CallerTemplateKind;
  businessName?: string | null;
  callerName?: string | null;
  item?: string | null;
  when?: string | null;
}): string {
  const business = String(opts.businessName || "").trim() || "We";
  const hi = callerHi(String(opts.callerName || "").trim());
  const item = String(opts.item || "").trim();
  const when = String(opts.when || "").trim();
  switch (opts.kind) {
    case "caller_appointment":
      return `${hi}${business} here. We have ${visitWhat(item)}${forWhen(when)}. We will confirm shortly.`;
    case "caller_appointment_confirmed": {
      const what = item ? `${item} visit` : "visit";
      return `${hi}${business} here. Your ${what}${forWhen(when)} is confirmed.`;
    }
    case "caller_appointment_cancelled":
      return `${hi}${business} here. We cancelled ${visitWhat(item)}${forWhen(when)}.`;
    case "caller_appointment_rescheduled":
      return `${hi}${business} here. We moved ${visitWhat(item)}${toWhen(when)}.`;
    case "caller_hold": {
      const what = item ? `We have held ${item} for you` : "We have held your item";
      return `${hi}${business} here. ${what}. We will confirm shortly.`;
    }
    case "caller_hold_updated": {
      const what = item ? `Pickup for ${item}` : "Pickup";
      const now = when ? ` is now ${when}` : " was updated";
      return `${hi}${business} here. ${what}${now}.`;
    }
    case "caller_hold_ready": {
      const what = item ? `${item} is ready for pickup` : "Your item is ready for pickup";
      return `${hi}${business} here. ${what}.`;
    }
    case "caller_hold_cancelled": {
      const what = item ? `We cancelled the pickup for ${item}` : "We cancelled your pickup";
      return `${hi}${business} here. ${what}.`;
    }
    case "caller_order": {
      const what = item ? `your order for ${item}` : "your order";
      return `${hi}${business} here. We have ${what}. We will confirm shortly.`;
    }
    case "caller_callback":
      return `${hi}${business} here. The team will call you back.`;
    default:
      return `${hi}${business} here. We have your request. We will confirm shortly.`;
  }
}
