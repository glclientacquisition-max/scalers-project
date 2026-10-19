import { NextResponse } from "next/server";
import { retryStoredReads } from "@/lib/invoicePay/retryReads";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { assertBachsAllowed, bachsMode, payProviderFromEnv } from "@/lib/invoicePay/provider";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Retries stored unreadable Bachs reads. Vercel does not call this until a
 * cron entry is added. The schedule, once enabled, is minute 7, 22, 37, and
 * 52 of every hour. Live mode settles only those stored events, and only for
 * an allowlisted business. A closed gate does not call Bachs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const header = request.headers.get("authorization") || "";
  if (!secret || header !== `Bearer ${secret}`) {
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
    return NextResponse.json({ ok: true, retried: result.rows.length });
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
