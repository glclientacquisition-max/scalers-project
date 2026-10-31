/**
 * One contact field: a Kenya phone or an email. No network and no storage.
 * Phone shapes match dashboard/src/lib/handoffMode.ts normalizeKenyaE164.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type RequestAccessError = "name" | "contact" | "contact_invalid" | "consent";

export type RequestAccessValue = {
  name: string;
  contact: string;
  kind: "email" | "phone";
};

export function normalizeRequestPhone(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.includes("@")) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`;
  }
  if (!/^254\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

export function validateRequestAccess(input: {
  name: string;
  contact: string;
  consent: boolean;
}): { ok: true; value: RequestAccessValue } | { ok: false; error: RequestAccessError } {
  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "name" };
  if (!input.consent) return { ok: false, error: "consent" };
  const contact = String(input.contact || "").trim();
  if (!contact) return { ok: false, error: "contact" };
  if (contact.includes("@")) {
    if (!EMAIL_RE.test(contact)) return { ok: false, error: "contact_invalid" };
    return { ok: true, value: { name, contact: contact.toLowerCase(), kind: "email" } };
  }
  const phone = normalizeRequestPhone(contact);
  if (!phone) return { ok: false, error: "contact_invalid" };
  return { ok: true, value: { name, contact: phone, kind: "phone" } };
}

export type RequestAccessAdapter = {
  submitRequestAccess: (input: RequestAccessValue) => Promise<void>;
};

/** Local stub. Does not call the network. Swap the adapter when the backend exists. */
export function createMockRequestAccessAdapter(): RequestAccessAdapter {
  return {
    async submitRequestAccess() {
      return;
    },
  };
}

export async function submitRequestAccess(
  adapter: RequestAccessAdapter,
  input: RequestAccessValue,
): Promise<void> {
  await adapter.submitRequestAccess(input);
}
