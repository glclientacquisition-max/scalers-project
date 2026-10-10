import { normalizeKenyaE164 } from "./handoffMode";

export type CreateWorkspaceInput =
  | { ok: true; businessName: string; notificationPhone: string }
  | { ok: false; error: string };

/** Validate the signed-in "create workspace" form (no email/password: session already exists). */
export function parseCreateWorkspaceInput(raw: {
  businessName: unknown;
  notificationPhone: unknown;
}): CreateWorkspaceInput {
  const businessName = String(raw.businessName ?? "").trim();
  if (!businessName) return { ok: false, error: "Business name is required." };
  if (businessName.length > 120) return { ok: false, error: "Business name is too long (120 max)." };
  const notificationPhone = normalizeKenyaE164(raw.notificationPhone);
  if (!notificationPhone) {
    return { ok: false, error: "Enter a valid Kenyan phone number (e.g. 0712 345 678)." };
  }
  return { ok: true, businessName, notificationPhone };
}
