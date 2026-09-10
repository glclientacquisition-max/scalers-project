/**
 * Desk-side caller SMS (owner Confirm / Cancel).
 * Uses the same TextSMS env as voice when present on Vercel.
 */

type CallerKind =
  | "caller_appointment"
  | "caller_appointment_confirmed"
  | "caller_appointment_cancelled"
  | "caller_appointment_rescheduled"
  | "caller_hold_updated";

function normalizeSmsTo(phone: string): string {
  let digits = String(phone || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  return digits;
}

function cleanName(raw: string | null | undefined): string {
  const name = String(raw || "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  const lower = name.toLowerCase();
  if (
    !name ||
    ["calling", "callings", "haijawekwa", "caller", "customer", "unknown"].includes(
      lower
    )
  ) {
    return "";
  }
  return name;
}

export function renderDeskCallerText(opts: {
  kind: CallerKind;
  businessName: string;
  callerName?: string | null;
  service?: string | null;
  when?: string | null;
}): string {
  const business = String(opts.businessName || "").trim() || "We";
  const name = cleanName(opts.callerName);
  const hi = name ? `Hi ${name}, ` : "Hi, ";
  const service = String(opts.service || "").trim();
  const when = String(opts.when || "").trim();
  const what = service ? `your ${service} visit` : "your visit";
  const at = when ? ` for ${when}` : "";
  const to = when ? ` to ${when}` : "";
  switch (opts.kind) {
    case "caller_appointment_confirmed":
      return `${hi}${business} here. Your ${service ? `${service} visit` : "visit"}${at} is confirmed.`;
    case "caller_appointment_cancelled":
      return `${hi}${business} here. We cancelled ${what}${at}.`;
    case "caller_appointment_rescheduled":
      return `${hi}${business} here. We moved ${what}${to}.`;
    case "caller_hold_updated": {
      const item = String(opts.service || "").trim();
      const when = String(opts.when || "").trim();
      const what = item ? `Pickup for ${item}` : "Pickup";
      const now = when ? ` is now ${when}` : " was updated";
      return `${hi}${business} here. ${what}${now}.`;
    }
    default:
      return `${hi}${business} here. We have ${what}${at}. We will confirm shortly.`;
  }
}

export async function sendDeskCallerSms(opts: {
  to: string;
  body: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.TEXTSMS_API_KEY;
  const partnerID = process.env.TEXTSMS_PARTNER_ID;
  const shortcode = process.env.TEXTSMS_SHORTCODE;
  if (!apiKey || !partnerID || !shortcode) {
    return { ok: false, reason: "sms_not_configured" };
  }
  const mobile = normalizeSmsTo(opts.to);
  if (!mobile || mobile.length < 9) {
    return { ok: false, reason: "no_caller_phone" };
  }
  const message = String(opts.body || "").trim();
  if (!message) return { ok: false, reason: "empty_body" };

  const url =
    process.env.TEXTSMS_API_URL || "https://sms.textsms.co.ke/api/services/sendsms/";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      partnerID: String(partnerID),
      message,
      shortcode: String(shortcode),
      mobile,
      pass_type: "plain",
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | { responses?: Array<{ "respose-code"?: number; "response-code"?: number }> }
    | null;
  const first = Array.isArray(json?.responses) ? json.responses[0] : null;
  const code = Number(first?.["respose-code"] ?? first?.["response-code"] ?? NaN);
  if (!res.ok || (Number.isFinite(code) && code !== 200)) {
    return { ok: false, reason: `textsms_${res.status}` };
  }
  return { ok: true };
}
