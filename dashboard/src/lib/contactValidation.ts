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
 * A channel switched on with nothing to deliver to is an error, not a silent no-op.
 */
export function validateAlertsSave(input: {
  phone: string;
  email: string;
  channels: { sms?: boolean; whatsapp?: boolean; email?: boolean };
}): { ok: true; phone: string; email: string | null } | { ok: false; error: string } {
  const rawPhone = String(input.phone || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  let phone = "";
  if (rawPhone) {
    const normalized = normalizeContactPhone(rawPhone);
    if (!normalized) return { ok: false, error: `"${rawPhone}" is not a valid alert phone. Use e.g. 0712 345 678.` };
    phone = normalized;
  }
  if (email && !isValidEmail(email)) return { ok: false, error: "Alert email looks invalid." };
  if (input.channels.email && !email) {
    return { ok: false, error: "Add an alert email, or turn off Email alerts." };
  }
  if ((input.channels.sms || input.channels.whatsapp) && !phone) {
    return { ok: false, error: "Add an alert phone, or turn off SMS and WhatsApp alerts." };
  }
  return { ok: true, phone, email: email || null };
}
