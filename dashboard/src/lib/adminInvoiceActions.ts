import "server-only";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminErrorParts, logAdminError } from "@/lib/adminErrors";
import {
  balanceKes,
  canCreditNote,
  canDisputeInvoice,
  canResendInvoice,
  canVoidInvoice,
  isValidResendEmail,
  resolveResendRecipients,
  type ResendMode,
} from "@/lib/ops/invoiceActions";
import { isOpsMailConfigured, sendOpsMail } from "@/lib/opsMail";
import { getSupabaseAdmin } from "@/lib/supabase";

const RPC_MISSING =
  "This action needs the invoice write path on the database. Nothing changed.";
const SAVE_FAILED = "That didn't save. Nothing changed. Try again, or check Activity.";

export function isMissingInvoiceActionRpc(err: unknown): boolean {
  const { message, code } = adminErrorParts(err);
  return (
    code === "PGRST202" ||
    code === "42883" ||
    (/admin_(void_invoice|issue_credit_note|set_invoice_dispute)/i.test(message) &&
      /could not find|does not exist/i.test(message))
  );
}

function raiseFacing(err: unknown): never {
  if (isMissingInvoiceActionRpc(err)) {
    const e = new Error(RPC_MISSING);
    (e as Error & { status: number }).status = 501;
    throw e;
  }
  const { message, code } = adminErrorParts(err);
  // Deliberate raise exception (P0001) — safe enough for the operator.
  if (code === "P0001" && message) {
    const e = new Error(message);
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  logAdminError("invoice-action", err);
  const e = new Error(SAVE_FAILED);
  (e as Error & { status: number }).status = 500;
  throw e;
}

type InvoiceSnap = {
  id: string;
  tenant_id: string;
  invoice_number: string | null;
  status: string;
  total_kes: number | string | null;
  amount_paid_kes: number | string | null;
  reminders_paused_at?: string | null;
};

async function loadInvoice(id: string): Promise<InvoiceSnap | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("invoices")
    .select("id, tenant_id, invoice_number, status, total_kes, amount_paid_kes, reminders_paused_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    // Column may be missing until admin_invoice_actions.sql is applied.
    if (/reminders_paused_at/i.test(adminErrorParts(error).message) || adminErrorParts(error).code === "42703") {
      const retry = await admin
        .from("invoices")
        .select("id, tenant_id, invoice_number, status, total_kes, amount_paid_kes")
        .eq("id", id)
        .maybeSingle();
      if (retry.error) throw retry.error;
      return retry.data as InvoiceSnap | null;
    }
    throw error;
  }
  return data as InvoiceSnap | null;
}

async function loadBillingEmail(tenantId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tenants")
    .select("alert_email")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw error;
  const email = String(data?.alert_email || "").trim();
  return isValidResendEmail(email) ? email.toLowerCase() : null;
}

function toActionRow(inv: InvoiceSnap) {
  const total = Number(inv.total_kes || 0);
  const paid = Number(inv.amount_paid_kes || 0);
  return {
    id: inv.id,
    number: inv.invoice_number ? String(inv.invoice_number) : "Draft",
    status: String(inv.status || ""),
    totalCents: Math.round(total * 100),
    paidCents: Math.round(paid * 100),
    remindersPausedAt: inv.reminders_paused_at ? String(inv.reminders_paused_at) : null,
  };
}

export async function voidAdminInvoice(opts: {
  invoiceId: string;
  actor: string;
  reason: string;
}): Promise<{ status_before: string; status_after: string }> {
  const inv = await loadInvoice(opts.invoiceId);
  if (!inv) {
    const e = new Error("Invoice not found.");
    (e as Error & { status: number }).status = 404;
    throw e;
  }
  const row = toActionRow(inv);
  if (!canVoidInvoice(row)) {
    const e = new Error(
      row.status === "paid" ? "Paid invoices cannot be voided." : "Only open or draft invoices can be voided.",
    );
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  if (opts.reason.trim().length < 3) {
    const e = new Error("Add a reason (3 characters or more).");
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  const { data, error } = await getSupabaseAdmin().rpc("admin_void_invoice", {
    p_invoice_id: opts.invoiceId,
    p_actor: opts.actor,
    p_reason: opts.reason.trim(),
  });
  if (error) raiseFacing(error);
  const out = (Array.isArray(data) ? data[0] : data) as {
    status_before?: string;
    status_after?: string;
  } | null;
  await recordAdminAction({
    actor: opts.actor,
    action: "void_invoice",
    businessId: inv.tenant_id,
    reason: opts.reason.trim(),
    before: { status: out?.status_before || inv.status },
    after: { status: out?.status_after || "void", invoice_id: inv.id },
  });
  return {
    status_before: String(out?.status_before || inv.status),
    status_after: String(out?.status_after || "void"),
  };
}

export async function issueAdminCreditNote(opts: {
  invoiceId: string;
  actor: string;
  reason: string;
}): Promise<{ credit_kes: number; status_after: string }> {
  const inv = await loadInvoice(opts.invoiceId);
  if (!inv) {
    const e = new Error("Invoice not found.");
    (e as Error & { status: number }).status = 404;
    throw e;
  }
  const row = toActionRow(inv);
  if (!canCreditNote(row)) {
    const e = new Error(
      row.status !== "open" ? "Credit notes are for open invoices only." : "Nothing left to credit on this invoice.",
    );
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  if (opts.reason.trim().length < 3) {
    const e = new Error("Add a reason (3 characters or more).");
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  const { data, error } = await getSupabaseAdmin().rpc("admin_issue_credit_note", {
    p_invoice_id: opts.invoiceId,
    p_actor: opts.actor,
    p_reason: opts.reason.trim(),
  });
  if (error) raiseFacing(error);
  const out = (Array.isArray(data) ? data[0] : data) as {
    credit_kes?: number | string;
    status_after?: string;
  } | null;
  const credit = Number(out?.credit_kes ?? balanceKes(row));
  await recordAdminAction({
    actor: opts.actor,
    action: "credit_note",
    businessId: inv.tenant_id,
    reason: opts.reason.trim(),
    before: { status: inv.status, balance_kes: balanceKes(row) },
    after: { status: out?.status_after || "void", credit_kes: credit, invoice_id: inv.id },
  });
  return { credit_kes: credit, status_after: String(out?.status_after || "void") };
}

export async function setAdminInvoiceDispute(opts: {
  invoiceId: string;
  paused: boolean;
  actor: string;
  reason: string;
}): Promise<{ reminders_paused_at: string | null }> {
  const inv = await loadInvoice(opts.invoiceId);
  if (!inv) {
    const e = new Error("Invoice not found.");
    (e as Error & { status: number }).status = 404;
    throw e;
  }
  const row = toActionRow(inv);
  if (!canDisputeInvoice(row)) {
    const e = new Error("Only an open invoice can be marked disputed.");
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  if (opts.reason.trim().length < 3) {
    const e = new Error("Add a reason (3 characters or more).");
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  const { data, error } = await getSupabaseAdmin().rpc("admin_set_invoice_dispute", {
    p_invoice_id: opts.invoiceId,
    p_paused: opts.paused,
    p_actor: opts.actor,
    p_reason: opts.reason.trim(),
  });
  if (error) raiseFacing(error);
  const out = (Array.isArray(data) ? data[0] : data) as { reminders_paused_at?: string | null } | null;
  const at = out?.reminders_paused_at ? String(out.reminders_paused_at) : null;
  await recordAdminAction({
    actor: opts.actor,
    action: opts.paused ? "dispute_invoice" : "clear_invoice_dispute",
    businessId: inv.tenant_id,
    reason: opts.reason.trim(),
    before: { reminders_paused_at: inv.reminders_paused_at || null },
    after: { reminders_paused_at: at, invoice_id: inv.id },
  });
  return { reminders_paused_at: at };
}

export async function resendAdminInvoice(opts: {
  invoiceId: string;
  actor: string;
  mode: ResendMode;
  typedEmail: string;
  reason?: string;
}): Promise<{ to: string[]; sent: number }> {
  const inv = await loadInvoice(opts.invoiceId);
  if (!inv) {
    const e = new Error("Invoice not found.");
    (e as Error & { status: number }).status = 404;
    throw e;
  }
  const row = toActionRow(inv);
  if (!canResendInvoice(row)) {
    const e = new Error("Draft invoices have no number to send again yet.");
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  const saved = await loadBillingEmail(inv.tenant_id);
  const picked = resolveResendRecipients({
    savedEmail: saved,
    typedEmail: opts.typedEmail,
    mode: opts.mode,
  });
  if (!picked.ok) {
    const e = new Error(picked.error);
    (e as Error & { status: number }).status = 400;
    throw e;
  }
  if (!isOpsMailConfigured()) {
    const e = new Error("Email sending is off on this server. Nothing was sent.");
    (e as Error & { status: number }).status = 503;
    throw e;
  }
  const number = row.number;
  const balance = balanceKes(row);
  const subject = `Scalers invoice ${number}`;
  const text = [
    `Invoice ${number}`,
    `Status: ${row.status}`,
    balance > 0 ? `Balance: KSh ${balance.toLocaleString("en-KE")}` : "Balance: KSh 0",
    "",
    `PDF (signed-in Admin): /api/admin/billing/invoices/${inv.id}/pdf`,
    `Owner pay history is on the Desk under Billing.`,
    "",
    "Sent by Scalers Admin.",
  ].join("\n");
  const out = await sendOpsMail({
    to: picked.to,
    subject,
    text,
    ledger: {
      kind: "admin_invoice_resend",
      key: `admin:invoice-resend:${inv.id}:${picked.to.sort().join(",")}:${new Date().toISOString().slice(0, 13)}`,
    },
  });
  if (out.sent <= 0) {
    const e = new Error(
      out.skipped === "ops_mail_unconfigured"
        ? "Email sending is off on this server. Nothing was sent."
        : out.skipped === "no_recipients"
          ? "Pick a saved contact or type an email."
          : `Nothing was sent (${out.skipped || "skipped"}).`,
    );
    (e as Error & { status: number }).status = 503;
    throw e;
  }
  await recordAdminAction({
    actor: opts.actor,
    action: "resend_invoice",
    businessId: inv.tenant_id,
    reason: opts.reason?.trim() || null,
    after: {
      invoice_id: inv.id,
      invoice_number: number,
      to: picked.to,
      mode: opts.mode,
      sent: out.sent,
    },
  });
  return { to: picked.to, sent: out.sent };
}
