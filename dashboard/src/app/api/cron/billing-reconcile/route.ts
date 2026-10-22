import { NextResponse } from "next/server";
import { billingPaymentCronOk } from "../billing-payment-retry/route";
import { billingReconcileReport } from "@/lib/invoicePay/reconcile";
import { payProviderFromEnv } from "@/lib/invoicePay/provider";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Report-only payment reconcile. Vercel does not call this. It is not in
 * vercel.json. Counts come from billing_payment_reconciliation. Bachs is
 * read only when BACHS_MODE is sandbox or an allowed live mode. No writes.
 */
export async function GET(request: Request) {
  if (!billingPaymentCronOk(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  try {
    const counts = await billingReconcileReport({
      async listRows() {
        const { data, error } = await admin.rpc("billing_payment_reconciliation");
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []) as Array<{
          kind?: string;
          attempt_id?: string | null;
          invoice_id?: string | null;
          payment_id?: string | null;
          detail?: string | null;
        }>;
        return rows.map((row) => ({
          kind: row.kind,
          attemptId: row.attempt_id,
          invoiceId: row.invoice_id,
          paymentId: row.payment_id,
          detail: row.detail,
        }));
      },
      async loadAttempts(ids) {
        const { data, error } = await admin
          .from("payment_attempts")
          .select("id, checkout_session_id, status")
          .in("id", ids);
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []) as Array<{
          id: string;
          checkout_session_id?: string | null;
          status?: string | null;
        }>;
        return rows.map((row) => ({
          id: row.id,
          checkoutSessionId: row.checkout_session_id,
          status: row.status,
        }));
      },
      getCheckout(checkoutId) {
        return payProviderFromEnv().getCheckout(checkoutId);
      },
    });
    return NextResponse.json({
      ok: true,
      matched: counts.matched,
      mismatch: counts.mismatch,
      missing_ours: counts.missing_ours,
      missing_bachs: counts.missing_bachs,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
