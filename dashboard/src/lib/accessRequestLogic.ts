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

export type AccessRequestStatus = "pending" | "approved" | "declined";

export type AccessRequestListRow = {
  id: string;
  created_at: string;
  name: string;
  business: string;
  phone: string;
  email: string;
  about: string;
  status: AccessRequestStatus;
  decided_at: string | null;
  decided_by: string | null;
  invited_user_id?: string | null;
  note?: string | null;
  note_updated_at?: string | null;
  note_updated_by?: string | null;
  decline_reason?: string | null;
  decline_emailed_at?: string | null;
  invite_resent_at?: string | null;
  reopened_at?: string | null;
};

export function normalizeAccessRequestEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/** E.164 tel: href for Kenyan numbers. */
export function telHrefForAccess(phone: string): string | null {
  const normalized = normalizeKenyaPhone(phone);
  if (!normalized) return null;
  return `tel:${normalized}`;
}

function kenyaMobileDigits(phone: string): string | null {
  const normalized = normalizeKenyaPhone(phone);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  if (!/^254[17]\d{8}$/.test(digits)) return null;
  return digits;
}

/** wa.me digits (2547…); Kenyan 07.. becomes 2547.. */
export function waMeHrefForAccess(phone: string): string | null {
  const digits = kenyaMobileDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

export type AccessRequestStatusFilter = AccessRequestStatus | "all";

export function parseAccessRequestStatusFilter(raw: string | undefined): AccessRequestStatusFilter {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "pending" || s === "approved" || s === "declined") return s;
  return "all";
}

export function filterAccessRequestsByStatus<T extends { status: AccessRequestStatus }>(
  rows: T[],
  status: AccessRequestStatusFilter
): T[] {
  if (status === "all") return rows;
  return rows.filter((row) => row.status === status);
}

export function matchesAccessRequestSearch(
  row: Pick<AccessRequestListRow, "name" | "business" | "email" | "phone">,
  query: string
): boolean {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [row.name, row.business, row.email, row.phone].join(" ").toLowerCase();
  return hay.includes(q);
}

export function countAccessRequestsByStatus(
  rows: readonly { status: AccessRequestStatus }[]
): Record<AccessRequestStatus, number> {
  const counts: Record<AccessRequestStatus, number> = {
    pending: 0,
    approved: 0,
    declined: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Total requests in the same phone or email group (including this row). */
export function buildAccessRequestRepeatCounts(
  rows: readonly Pick<AccessRequestListRow, "id" | "phone" | "email">[]
): Record<string, number> {
  const byPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();

  for (const row of rows) {
    const phoneKey = kenyaMobileDigits(row.phone);
    if (phoneKey) {
      const list = byPhone.get(phoneKey) ?? [];
      list.push(row.id);
      byPhone.set(phoneKey, list);
    }
    const emailKey = normalizeAccessRequestEmail(row.email);
    if (emailKey) {
      const list = byEmail.get(emailKey) ?? [];
      list.push(row.id);
      byEmail.set(emailKey, list);
    }
  }

  const out: Record<string, number> = {};
  for (const row of rows) {
    const group = new Set<string>();
    const phoneKey = kenyaMobileDigits(row.phone);
    if (phoneKey) for (const id of byPhone.get(phoneKey) ?? []) group.add(id);
    const emailKey = normalizeAccessRequestEmail(row.email);
    if (emailKey) for (const id of byEmail.get(emailKey) ?? []) group.add(id);
    out[row.id] = group.size;
  }
  return out;
}

export function sortAccessRequestsForAdmin<T extends Pick<AccessRequestListRow, "status" | "created_at">>(
  rows: T[]
): T[] {
  const order: Record<AccessRequestStatus, number> = { pending: 0, approved: 1, declined: 2 };
  return [...rows].sort((a, b) => {
    const byStatus = order[a.status] - order[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function isAccessRequestsSchemaV2Error(message: string): boolean {
  const m = String(message || "").toLowerCase();
  return m.includes("column") && (m.includes("does not exist") || m.includes("could not find"));
}
