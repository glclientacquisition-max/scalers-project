import { normalizeKenyaE164 } from "./handoffMode";

export type TeamRowInput = {
  name?: unknown;
  role?: unknown;
  phone?: unknown;
  email?: unknown;
  [key: string]: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(raw: unknown): boolean {
  return EMAIL_RE.test(String(raw ?? "").trim());
}

/** Kenyan numbers -> E.164; other international "+<8-15 digits>" kept; anything else invalid. */
export function normalizeContactPhone(raw: unknown): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const ke = normalizeKenyaE164(trimmed);
  if (ke) return ke;
  const intl = trimmed.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(intl) && !intl.startsWith("+254")) return intl;
  return null;
}

function phoneKey(raw: unknown): string {
  return normalizeContactPhone(raw) || String(raw ?? "").replace(/\D/g, "");
}

export type TeamValidationResult =
  | { ok: true; rows: TeamRowInput[] }
  | { ok: false; error: string };

/**
 * Validate a Team save as a whole, returning a visible error instead of the old
 * behaviour (nameless rows silently dropped, bad emails failing the whole form).
 */
export function validateTeamSave(input: {
  submitted: TeamRowInput[];
  stored: TeamRowInput[];
  ownerPhone?: string | null;
}): TeamValidationResult {
  const rows: TeamRowInput[] = [];
  const seenPhones = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  for (let i = 0; i < input.submitted.length; i += 1) {
    const row = input.submitted[i];
    const n = i + 1;
    const name = String(row.name ?? "").trim();
    const role = String(row.role ?? "").trim();
    const phoneRaw = String(row.phone ?? "").trim();
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!name && !role && !phoneRaw && !email) continue; // blank row
    if (!name) return { ok: false, error: `Teammate ${n}: add a name.` };
    if (name.length > 80) return { ok: false, error: `Teammate ${n}: name is too long (80 max).` };
    let phone = "";
    if (phoneRaw) {
      const normalized = normalizeContactPhone(phoneRaw);
      if (!normalized) {
        return { ok: false, error: `${name}: "${phoneRaw}" is not a valid phone number. Use e.g. 0712 345 678.` };
      }
      phone = normalized;
    }
    if (email && !isValidEmail(email)) {
      return { ok: false, error: `${name}: "${email}" is not a valid email address.` };
    }
    if (!phone && !email) {
      return { ok: false, error: `${name}: add a phone number or an email so alerts can reach them.` };
    }
    if (phone) {
      const prev = seenPhones.get(phone);
      if (prev) return { ok: false, error: `Teammates ${prev} and ${n} have the same phone number.` };
      seenPhones.set(phone, n);
    }
    if (email) {
      const prev = seenEmails.get(email);
      if (prev) return { ok: false, error: `Teammates ${prev} and ${n} have the same email.` };
      seenEmails.set(email, n);
    }
    rows.push({ ...row, name, role, phone, ...(email ? { email } : { email: undefined }) });
  }

  const ownerKey = input.ownerPhone ? phoneKey(input.ownerPhone) : "";
  if (ownerKey) {
    const ownerWasListed = input.stored.some((row) => phoneKey(row.phone) === ownerKey);
    const ownerStillListed = rows.some((row) => phoneKey(row.phone) === ownerKey);
    if (ownerWasListed && !ownerStillListed) {
      return { ok: false, error: "The owner can't be removed from the team. Change the owner's alert phone first." };
    }
  }

  return { ok: true, rows: rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))) };
}

/** The owner's alert phone (tenants.whatsapp_notification_number) identifies the owner team row. */
export function ownerAlertPhone(tenant: { whatsapp_notification_number?: string | null }): string | null {
  return tenant.whatsapp_notification_number ?? null;
}
