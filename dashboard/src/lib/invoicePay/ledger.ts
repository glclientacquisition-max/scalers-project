import { getSupabaseAdmin } from "@/lib/supabase";
import { assertBachsAllowed } from "./provider";

type Json = Record<string, unknown>;

function asObject(data: unknown): Json | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Json;
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export type PayLookup = {
  found: boolean;
  state?: string;
  businessName?: string;
  invoiceNumber?: string;
  invoiceId?: string;
  tenantId?: string;
  subtotalKes?: string;
  totalKes?: string;
  amountPaidKes?: string;
  dueAt?: string | null;
  enforcement?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
};

export function mapLookup(data: unknown): PayLookup {
  const row = asObject(data);
  if (!row || row.found !== true) return { found: false };
  return {
    found: true,
    state: text(row.state),
    businessName: text(row.business_name),
    invoiceNumber: text(row.invoice_number),
    invoiceId: text(row.invoice_id),
    tenantId: text(row.tenant_id),
    subtotalKes: text(row.subtotal_kes),
    totalKes: text(row.total_kes),
    amountPaidKes: text(row.amount_paid_kes || "0"),
    dueAt: row.due_at ? text(row.due_at) : null,
    enforcement: text(row.enforcement),
    ownerName: row.owner_name ? text(row.owner_name) : "",
    ownerEmail: row.owner_email ? text(row.owner_email) : "",
    ownerPhone: row.owner_phone ? text(row.owner_phone) : "",
  };
}

function mapAttempt(data: unknown) {
  const row = asObject(data);
  if (!row) return null;
  return {
    id: text(row.id),
    invoiceId: text(row.invoice_id),
    tenantId: text(row.tenant_id),
    status: text(row.status),
    amountKes: text(row.amount_kes),
    currency: text(row.currency || "KES"),
    partIndex: Number(row.part_index || 0),
    partCount: Number(row.part_count || 0),
    checkoutSessionId: row.checkout_session_id ? text(row.checkout_session_id) : null,
    livePart: row.live_part === true,
  };
}

function rpcError(error: { message?: string } | null, fallback: string): Error {
  const err = new Error(error?.message || fallback);
  return err;
}

/** Service-role ledger. Refuses a production project URL. */
export function invoicePayLedger(env: NodeJS.ProcessEnv = process.env) {
  assertBachsAllowed(env);
  const admin = getSupabaseAdmin();

  return {
    async lookup(token: string) {
      const { data, error } = await admin.rpc("pay_invoice_by_token", { p_token: token });
      if (error) throw rpcError(error, "lookup failed");
      return mapLookup(data);
    },

    async createAttempt(input: { token: string; amountKes: string }) {
      const { data, error } = await admin.rpc("create_invoice_pay_attempt", {
        p_token: input.token,
        p_amount_kes: input.amountKes,
      });
      if (error) throw rpcError(error, "attempt failed");
      const row = asObject(data);
      if (!row) throw new Error("attempt failed");
      return {
        id: text(row.id),
        checkoutSessionId: row.checkout_session_id ? text(row.checkout_session_id) : null,
        checkoutUrl: row.checkout_url ? text(row.checkout_url) : null,
        amountKes: text(row.amount_kes),
        partIndex: Number(row.part_index || 0),
        partCount: Number(row.part_count || 0),
        returnId: row.return_id ? text(row.return_id) : null,
        reused: row.reused === true,
        inFlight: row.in_flight === true,
        cancel: row.cancel === true,
        unattached: row.unattached === true,
      };
    },

    async parkUnattached(
      attemptId: string,
      created: { checkoutId: string; checkoutUrl?: string | null; expiresAt?: string | null }
    ) {
      const { error } = await admin.rpc("park_invoice_pay_attempt", {
        p_attempt_id: attemptId,
        p_checkout_session_id: created.checkoutId,
        p_checkout_url: created.checkoutUrl || null,
        p_expires_at: created.expiresAt || null,
      });
      if (error) throw rpcError(error, "park failed");
    },

    async attachCheckout(
      attemptId: string,
      created: { checkoutId: string; checkoutUrl: string; expiresAt?: string | null }
    ) {
      const { error } = await admin.rpc("attach_invoice_pay_checkout", {
        p_attempt_id: attemptId,
        p_checkout_session_id: created.checkoutId,
        p_checkout_url: created.checkoutUrl,
        p_expires_at: created.expiresAt || null,
      });
      if (error) throw rpcError(error, "attach failed");
    },

    async findAttemptByCheckout(checkoutId: string) {
      const { data, error } = await admin.rpc("invoice_pay_attempt_by_checkout", {
        p_checkout_id: checkoutId,
      });
      if (error) throw rpcError(error, "attempt lookup failed");
      return mapAttempt(data);
    },

    async markAttempt(
      attemptId: string,
      patch: {
        status: string;
        providerAmount?: string | null;
        providerCurrency?: string | null;
        feeAmount?: string | null;
        feeCurrency?: string | null;
        raw?: unknown;
      }
    ) {
      const { error } = await admin.rpc("settle_invoice_pay_attempt", {
        p_attempt_id: attemptId,
        p_status: patch.status,
        p_provider_amount: patch.providerAmount ?? null,
        p_provider_currency: patch.providerCurrency ?? null,
        p_fee_amount: patch.feeAmount ?? null,
        p_fee_currency: patch.feeCurrency ?? null,
        p_raw: patch.raw ?? {},
      });
      if (error) throw rpcError(error, "settle failed");
    },

    async recordEvent(input: { provider: string; eventKey: string; payload: unknown }) {
      const { data, error } = await admin.rpc("record_payment_event", {
        p_provider: input.provider,
        p_event_key: input.eventKey,
        p_payload: input.payload ?? {},
      });
      if (error) throw rpcError(error, "event failed");
      const row = asObject(data);
      return { attempts: Number(row?.attempts || 1) };
    },

    async findPaymentByRef(provider: string, providerRef: string) {
      const { data, error } = await admin
        .from("payments")
        .select("id, amount_kes, match_status")
        .eq("provider", provider)
        .eq("provider_ref", providerRef)
        .maybeSingle();
      if (error) throw rpcError(error, "payment lookup failed");
      if (!data?.id || data.match_status === "issue") return null;
      return {
        id: String(data.id),
        amountKes: text(data.amount_kes),
        matchStatus: text(data.match_status),
      };
    },

    async creditCancelled(input: { provider: string; providerRef: string; amountKes: string; tenantId: string }) {
      const { error } = await admin.rpc("credit_cancelled_collection", {
        p_provider: input.provider,
        p_provider_ref: input.providerRef,
        p_amount_kes: input.amountKes,
        p_tenant_id: input.tenantId,
      });
      if (error) throw rpcError(error, "cancelled credit failed");
    },

    async adjustOverpay(input: { provider: string; providerRef: string; amountKes: string; tenantId: string }) {
      const { error } = await admin.rpc("adjust_payment_overpay", {
        p_provider: input.provider,
        p_provider_ref: input.providerRef,
        p_amount_kes: input.amountKes,
        p_tenant_id: input.tenantId,
      });
      if (error) throw rpcError(error, "overpay adjust failed");
    },

    async lookupReturn(returnId: string) {
      const { data, error } = await admin.rpc("pay_invoice_by_return", { p_return_id: returnId });
      if (error) throw rpcError(error, "return lookup failed");
      const lookup = mapLookup(data);
      if (!lookup.found) return { found: false as const };
      const row = asObject(data);
      return {
        ...lookup,
        found: true as const,
        checkoutSessionId: row?.checkout_session_id ? text(row.checkout_session_id) : null,
        attemptStatus: row?.attempt_status ? text(row.attempt_status) : null,
      };
    },

    async applyPayment(input: {
      provider: string;
      providerRef: string;
      amountKes: string;
      tenantId: string;
      invoiceId: string;
      raw: unknown;
      settledAmountMinor: number | null;
      settledCurrency: string | null;
      feeMinor: number | null;
    }) {
      const { error } = await admin.rpc("apply_payment", {
        p_provider: input.provider,
        p_provider_ref: input.providerRef,
        p_amount_kes: input.amountKes,
        p_tenant_id: input.tenantId,
        p_invoice_id: input.invoiceId,
        p_actor: "bachs-webhook",
        p_raw: input.raw ?? {},
        p_settled_amount_minor: input.settledAmountMinor,
        p_settled_currency: input.settledCurrency,
        p_fee_minor: input.feeMinor,
        p_bill_ref: input.providerRef,
      });
      if (error) throw rpcError(error, "apply failed");
    },

    async recordIssue(input: {
      provider: string;
      providerRef: string;
      amountKes: string | null;
      tenantId: string;
      invoiceId: string;
      raw: unknown;
      settledAmountMinor: number | null;
      settledCurrency: string | null;
      feeMinor: number | null;
      reason: string;
    }) {
      const { error } = await admin.rpc("record_payment_issue", {
        p_provider: input.provider,
        p_provider_ref: input.providerRef,
        p_amount_kes: input.amountKes,
        p_tenant_id: input.tenantId,
        p_invoice_id: input.invoiceId,
        p_raw: input.raw ?? {},
        p_settled_amount_minor: input.settledAmountMinor,
        p_settled_currency: input.settledCurrency,
        p_fee_minor: input.feeMinor,
        p_reason: input.reason,
      });
      if (error) throw rpcError(error, "issue failed");
    },
  };
}
