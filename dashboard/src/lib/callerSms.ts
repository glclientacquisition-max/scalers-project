import { renderCallerTemplate, type CallerTemplateKind } from "@/lib/messageTemplates";

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
  kind: CallerTemplateKind;
  businessName: string;
  callerName?: string | null;
  service?: string | null;
  when?: string | null;
}): string {
  return renderCallerTemplate({
    kind: opts.kind,
    businessName: opts.businessName,
    callerName: cleanName(opts.callerName),
    item: opts.service,
    when: opts.when,
  });
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
