#!/usr/bin/env node
/**
 * Report payments stuck pending and invoices whose status disagrees.
 * Prints JSON. Does not update rows and does not call Bachs unless
 * BACHS_MODE=sandbox, and even then it only reads checkout status.
 *
 * Refuses the production project. Does not print secrets.
 */
"use strict";

const path = require("node:path");
const { assertNotProductionUrl, reconciliationReport } = require("../dashboard/src/lib/invoicePay/reconcile");
const { bachsMode, payProviderFromEnv } = require("../dashboard/src/lib/invoicePay/provider");

function loadSupabase() {
  try {
    return require("@supabase/supabase-js");
  } catch {
    return require(require.resolve("@supabase/supabase-js", {
      paths: [path.join(__dirname, "../dashboard")],
    }));
  }
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  assertNotProductionUrl(url);
  const mode = process.env.BACHS_MODE;
  const apiKey = process.env.BACHS_API_KEY;
  if (bachsMode({ BACHS_MODE: mode, BACHS_API_KEY: apiKey }) === "live") {
    throw new Error("BACHS_MODE=live is refused");
  }
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ ok: false, error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" }));
    process.exitCode = 1;
    return;
  }

  const { createClient } = loadSupabase();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("billing_payment_reconciliation");
  if (error) {
    console.log(JSON.stringify({ ok: false, error: "reconciliation failed" }));
    process.exitCode = 1;
    return;
  }

  const rows = (data || []).map((row) => ({
    kind: row.kind,
    attemptId: row.attempt_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id,
    detail: row.detail,
  }));

  if (bachsMode() === "sandbox") {
    const provider = payProviderFromEnv();
    const pending = rows.filter((row) => row.kind === "pending_timeout" && row.attemptId);
    const attempts = [];
    const providerStatuses = {};
    for (const row of pending) {
      const attempt = await admin
        .from("payment_attempts")
        .select("checkout_session_id, status, invoice_id, created_at")
        .eq("id", row.attemptId)
        .maybeSingle();
      const checkoutId = attempt.data?.checkout_session_id;
      if (!checkoutId) continue;
      const remote = await provider.getCheckout(checkoutId);
      if (!remote?.status) continue;
      providerStatuses[checkoutId] = remote.status;
      attempts.push({
        id: row.attemptId,
        invoiceId: row.invoiceId,
        status: attempt.data.status,
        checkoutSessionId: checkoutId,
        createdAt: attempt.data.created_at,
      });
    }
    const extra = reconciliationReport({
      attempts,
      invoices: [],
      payments: [],
      providerStatuses,
      now: Date.now(),
    }).filter((item) => item.kind === "provider_disagreement");
    rows.push(...extra);
  }

  console.log(JSON.stringify({ ok: true, changed: false, rows }, null, 2));
}

main().catch((err) => {
  const message = err && err.code === "prod_refused" ? "refusing production database" : "reconciliation failed";
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
});
