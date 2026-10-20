import { NextResponse } from "next/server";
import { retryStoredReads, sweepOpenCheckouts } from "@/lib/invoicePay/retryReads";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { billingCronAllows } from "@/lib/invoicePay/cronAuth";
import { assertBachsAllowed, bachsMode, payProviderFromEnv } from "@/lib/invoicePay/provider";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Bearer CRON_SECRET. An empty secret refuses every caller. */
export function billingPaymentCronOk(header: string | null): boolean {
  return billingCronAllows(header, process.env.CRON_SECRET || "");
}

/**
 * Live mode retries stored unreadable Bachs reads, then reads open checkouts
 * and applies charge.amount_paid as the running total. Vercel Hobby runs a
 * cron at most once a day, so the schedule is 03:07 UTC. An allowlisted
 * business is the only one read. A closed gate does not call Bachs.
 */
export async function GET(request: Request) {
  if (!billingPaymentCronOk(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BACHS_MODE: process.env.BACHS_MODE,
    BACHS_API_KEY: process.env.BACHS_API_KEY,
    BACHS_LIVE_ALLOWED: process.env.BACHS_LIVE_ALLOWED,
    BACHS_LIVE_TENANT_ALLOWLIST: process.env.BACHS_LIVE_TENANT_ALLOWLIST,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  try {
    assertBachsAllowed(env);
  } catch {
    return NextResponse.json({ ok: true, skipped: "payments_closed" });
  }
  if (bachsMode(env) !== "live") {
    return NextResponse.json({ ok: true, skipped: "not_live" });
  }

  const admin = getSupabaseAdmin();
  const ledger = invoicePayLedger();
  const provider = payProviderFromEnv(env);
  try {
    const sweep = await sweepOpenCheckouts({
      env,
      async listAttempts() {
        const { data, error } = await admin
          .from("payment_attempts")
          .select("tenant_id, invoice_id, checkout_session_id, status")
          .in("status", ["pending", "pending_unattached", "succeeded"])
          .not("checkout_session_id", "is", null);
        if (error) throw error;
        return (data || []).map((row) => ({
          tenantId: String(row.tenant_id),
          invoiceId: String(row.invoice_id),
          checkoutId: String(row.checkout_session_id),
        }));
      },
      getCheckout(checkoutId) {
        return provider.getCheckout(checkoutId);
      },
      settleTotal(input) {
        return ledger.reconcileCheckoutTotal(input as Parameters<typeof ledger.reconcileCheckoutTotal>[0]);
      },
    });
    const result = await retryStoredReads({
      env,
      async listEvents() {
        const { data, error } = await admin
          .from("payment_events")
          .select("event_key, payload")
          .eq("provider", "bachs")
          .eq("needs_retry", true);
        if (error) throw error;
        return (data || []).map((row) => ({
          eventKey: String(row.event_key),
          payload: row.payload && typeof row.payload === "object" ? (row.payload as object) : {},
        }));
      },
      async clearRetry(eventKey) {
        await ledgerClear(admin, eventKey);
      },
      async findAttempt(checkoutId) {
        return ledger.findAttemptByCheckout(checkoutId);
      },
      getCheckout(checkoutId) {
        return provider.getCheckout(checkoutId);
      },
      settle(input) {
        return ledger.settleCheckoutReading(input as Parameters<typeof ledger.settleCheckoutReading>[0]);
      },
    });
    return NextResponse.json({
      ok: true,
      retried: result.rows.length,
      swept: sweep.rows.length,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function ledgerClear(
  admin: ReturnType<typeof getSupabaseAdmin>,
  eventKey: string
) {
  const { error } = await admin.rpc("clear_payment_event_retry", {
    p_provider: "bachs",
    p_event_key: eventKey,
  });
  if (error) throw error;
}
