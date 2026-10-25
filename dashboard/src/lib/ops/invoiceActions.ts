/**
 * Invoice money actions (ADMIN_V2): pure shaping. No data access, no `@/` imports.
 * Credit note = full remaining balance only (no partial ledger math in this slice).
 * Resend = saved billing contact and/or a typed address.
 */

export type InvoiceActionRow = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paidCents: number;
  /** Saved billing contact (tenants.alert_email). */
  billingEmail?: string | null;
  /** When set, due-soon / overdue notices stay queued-off. */
  remindersPausedAt?: string | null;
};

export type ResendMode = "saved" | "typed" | "both";

export function balanceCents(r: Pick<InvoiceActionRow, "totalCents" | "paidCents">): number {
  return Math.max(0, r.totalCents - r.paidCents);
}

/** Integer KSh remaining (Money / OpsConfirm amount). */
export function balanceKes(r: Pick<InvoiceActionRow, "totalCents" | "paidCents">): number {
  return Math.round(balanceCents(r) / 100);
}

export function canVoidInvoice(r: InvoiceActionRow): boolean {
  return r.status === "open" || r.status === "draft";
}

/** Full-balance credit note on an open invoice with something still owed. */
export function canCreditNote(r: InvoiceActionRow): boolean {
  return r.status === "open" && balanceCents(r) > 0;
}

export function canResendInvoice(r: InvoiceActionRow): boolean {
  return r.status !== "draft" && Boolean(r.number) && r.number !== "Draft";
}

export function canDisputeInvoice(r: InvoiceActionRow): boolean {
  return r.status === "open";
}

export function isDisputed(r: InvoiceActionRow): boolean {
  return Boolean(r.remindersPausedAt);
}

/** Loose email check for the resend sheet (matches ops normalize shape). */
export function isValidResendEmail(raw: string): boolean {
  const email = String(raw || "").trim().toLowerCase();
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

/**
 * Pick who gets the invoice. Saved contact when chosen and present; typed when
 * valid. Mode "both" sends to both (deduped). Empty string = nowhere.
 */
export function resolveResendRecipients(opts: {
  savedEmail: string | null | undefined;
  typedEmail: string;
  mode: ResendMode;
}): { ok: true; to: string[] } | { ok: false; error: string } {
  const saved = isValidResendEmail(String(opts.savedEmail || ""))
    ? String(opts.savedEmail || "").trim().toLowerCase()
    : "";
  const typed = isValidResendEmail(opts.typedEmail) ? opts.typedEmail.trim().toLowerCase() : "";
  const to: string[] = [];
  if (opts.mode === "saved" || opts.mode === "both") {
    if (!saved) return { ok: false, error: "This business has no saved billing email." };
    to.push(saved);
  }
  if (opts.mode === "typed" || opts.mode === "both") {
    if (!typed) return { ok: false, error: "Enter a valid email address." };
    if (!to.includes(typed)) to.push(typed);
  }
  if (!to.length) return { ok: false, error: "Pick a saved contact or type an email." };
  return { ok: true, to };
}

export function voidBlockedWhy(r: InvoiceActionRow | null): string | null {
  if (!r) return "Pick an invoice.";
  if (r.status === "void" || r.status === "uncollectible") return "This invoice is already void.";
  if (r.status === "paid") return "Paid invoices cannot be voided.";
  if (!canVoidInvoice(r)) return "Only open or draft invoices can be voided.";
  return null;
}

export function creditBlockedWhy(r: InvoiceActionRow | null): string | null {
  if (!r) return "Pick an invoice.";
  if (r.status !== "open") return "Credit notes are for open invoices only.";
  if (balanceCents(r) <= 0) return "Nothing left to credit on this invoice.";
  return null;
}

export function resendBlockedWhy(r: InvoiceActionRow | null): string | null {
  if (!r) return "Pick an invoice.";
  if (!canResendInvoice(r)) return "Draft invoices have no number to send again yet.";
  return null;
}

export function disputeBlockedWhy(r: InvoiceActionRow | null): string | null {
  if (!r) return "Pick an invoice.";
  if (r.status !== "open") return "Only an open invoice can be marked disputed.";
  return null;
}
