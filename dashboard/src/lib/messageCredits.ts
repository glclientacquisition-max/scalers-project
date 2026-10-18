/**
 * One message-credit allowance per plan (owner decision, 18 Oct 2026). Texts,
 * WhatsApp and email all draw from it at the package version's burn per
 * message. Burns stay server-side: the owner only ever sees credits.
 * Pure, relative imports only, so node tests load it directly.
 */

export type CreditBurns = { sms: number; whatsapp: number; email: number };

export type MessageUse = { sms: number; whatsapp: number; email: number };

export type MessageCreditsUsage = { included: number; used: number; left: number };

function whole(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Burns from a package version row. Null when any burn is missing (pre-#778 data). */
export function creditBurnsFrom(row: Record<string, unknown>): CreditBurns | null {
  const read = (raw: unknown): number | null => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const sms = read(row.sms_credit_burn);
  const whatsapp = read(row.whatsapp_credit_burn);
  const email = read(row.email_credit_burn);
  if (sms == null || whatsapp == null || email == null) return null;
  return { sms, whatsapp, email };
}

/**
 * Credits left and used this period. Null hides the row: no allowance on the
 * version, or no burns to count with. Never falls back to per-channel buckets.
 */
export function messageCreditsUsage(
  included: number | null,
  burns: CreditBurns | null,
  use: MessageUse,
): MessageCreditsUsage | null {
  if (included == null || !burns) return null;
  const allowance = whole(included);
  if (allowance <= 0) return null;
  const used = Math.ceil(
    whole(use.sms) * burns.sms + whole(use.whatsapp) * burns.whatsapp + whole(use.email) * burns.email,
  );
  return { included: allowance, used, left: Math.max(0, allowance - used) };
}
