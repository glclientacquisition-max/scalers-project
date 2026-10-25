import { normalizeKenyaPhone } from "./kenyaPhone";

export type AccessRequestFields = {
  name: string;
  business: string;
  phone: string;
  email: string;
  about: string;
};

export type AccessRequestParseResult =
  | { ok: true; fields: AccessRequestFields }
  | { ok: false; error: string };

const ABOUT_MAX = 500;

export function parseAccessRequestForm(formData: FormData): AccessRequestParseResult {
  const honeypot = String(formData.get("company_website") || "").trim();
  if (honeypot) {
    return { ok: true, fields: { name: "", business: "", phone: "", email: "", about: "" } };
  }

  const name = String(formData.get("name") || "").trim();
  const business = String(formData.get("business_name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const about = String(formData.get("about") || "").trim();
  const phoneRaw = String(formData.get("phone") || "").trim();
  const phone = normalizeKenyaPhone(phoneRaw);

  if (!name) return { ok: false, error: "Enter your name." };
  if (!business) return { ok: false, error: "Business name is required." };
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (!phone) {
    return { ok: false, error: "Enter a valid Kenyan phone number (e.g. +2547…)." };
  }
  if (!about) return { ok: false, error: "Tell us briefly what the business does." };
  if (about.length > ABOUT_MAX) {
    return { ok: false, error: `Keep the description under ${ABOUT_MAX} characters.` };
  }

  return {
    ok: true,
    fields: { name, business, phone, email, about },
  };
}

/** Silent success for bots that fill the honeypot. */
export function isHoneypotSubmission(fields: AccessRequestFields): boolean {
  return !fields.name && !fields.email && !fields.business;
}
