import { isValidEmail, normalizeContactPhone } from "./teamValidation";
import type { SocialHandles } from "./socialHandles";

/**
 * Public contacts: phone/WhatsApp must be a real number (stored E.164), email must
 * look like an email. Returns normalized handles or a named error.
 */
export function validatePublicContacts(
  h: SocialHandles
): { ok: true; handles: SocialHandles } | { ok: false; error: string } {
  const channels = [];
  for (const c of h.channels || []) {
    const value = String(c.value || "").trim();
    if (!value) continue;
    if (c.kind === "phone" || c.kind === "whatsapp") {
      const phone = normalizeContactPhone(value);
      if (!phone) {
        return { ok: false, error: `${c.label || c.kind}: "${value}" is not a valid phone number. Use e.g. 0712 345 678.` };
      }
      channels.push({ ...c, value: phone });
    } else if (c.kind === "email") {
      if (!isValidEmail(value)) return { ok: false, error: `"${value}" is not a valid email address.` };
      channels.push({ ...c, value: value.toLowerCase() });
    } else {
      channels.push({ ...c, value });
    }
  }
  return { ok: true, handles: { ...h, channels } };
}

/**
 * Alerts save. Phone empty clears it; non-empty must normalize to E.164.
 * Owner decision: a channel switched on with nothing to deliver to is turned
 * off automatically (not a blocking error), and `note` explains why.
 */
export function validateAlertsSave<C extends { sms?: boolean; whatsapp?: boolean; email?: boolean }>(input: {
  phone: string;
  email: string;
  channels: C;
}):
  | { ok: true; phone: string; email: string | null; channels: C; note: string | null }
  | { ok: false; error: string } {
  const rawPhone = String(input.phone || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  let phone = "";
  if (rawPhone) {
    const normalized = normalizeContactPhone(rawPhone);
    if (!normalized) return { ok: false, error: `"${rawPhone}" is not a valid alert phone. Use e.g. 0712 345 678.` };
    phone = normalized;
  }
  if (email && !isValidEmail(email)) return { ok: false, error: "Alert email looks invalid." };
  const channels = { ...input.channels };
  const off: string[] = [];
  if (channels.email && !email) {
    channels.email = false;
    off.push("Email alerts (no alert email)");
  }
  const phoneOff: string[] = [];
  if (!phone && channels.sms) {
    channels.sms = false;
    phoneOff.push("SMS");
  }
  if (!phone && channels.whatsapp) {
    channels.whatsapp = false;
    phoneOff.push("WhatsApp");
  }
  if (phoneOff.length) off.push(`${phoneOff.join(" and ")} alerts (no alert phone)`);
  const note = off.length
    ? `Saved. We turned off ${off.join(" and ")}. Add the missing contact to turn ${off.length === 1 && phoneOff.length < 2 ? "it" : "them"} back on.`
    : null;
  return { ok: true, phone, email: email || null, channels, note };
}
