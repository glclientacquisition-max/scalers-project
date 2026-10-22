#!/usr/bin/env node
/**
 * Report payments stuck pending and invoices whose status disagrees.
 * Prints JSON. Does not print secrets.
 *
 * Sandbox, and only sandbox, also settles pending, pending-unattached,
 * and succeeded attempts from getCheckout charge.amount_paid. That sweep
 * does not run in live mode and does not run against production.
 *
 * Live mode, including the production project, also reads open checkouts and
 * applies charge.amount_paid as the running total, then retries payment_events
 * with needs_retry. The Bachs gate and the tenant allowlist both apply.
 * A stored event is settled once. An unreadable read stays stored.
 */
"use strict";

const path = require("node:path");
const { assertNotProductionUrl, reconciliationReport } = require("../dashboard/src/lib/invoicePay/reconcile");
const { collectedFromCheckout } = require("../dashboard/src/lib/invoicePay/webhook");
const { assertBachsAllowed, bachsMode, payProviderFromEnv } = require("../dashboard/src/lib/invoicePay/provider");
const { retryStoredReads, sweepOpenCheckouts } = require("../dashboard/src/lib/invoicePay/retryReads");

function loadSupabase() {
  try {
    return require("@supabase/supabase-js");
  } catch {
    return require(require.resolve("@supabase/supabase-js", {
      paths: [path.join(__dirname, "../dashboard")],
    }));
  }
}

function productionUrl(url) {
  return String(url || "").includes("fjxcdccgyhnvnnlnovcl");
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const live = bachsMode(process.env) === "live";
  if (live) {
    assertBachsAllowed(process.env);
  } else if (productionUrl(url)) {
    assertNotProductionUrl(url);
  } else {
    assertNotProductionUrl(url);
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

  if (!live && bachsMode() === "sandbox") {
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
      if (!remote?.paymentStatus) continue;
      providerStatuses[checkoutId] = remote.paymentStatus;
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

    const { data: openAttempts } = await admin
      .from("payment_attempts")
      .select("id, tenant_id, invoice_id, checkout_session_id, status")
      .in("status", ["pending", "pending_unattached", "succeeded"])
      .not("checkout_session_id", "is", null);
    for (const attempt of openAttempts || []) {
      const checkoutId = attempt.checkout_session_id;
      if (!checkoutId) continue;
      let remote;
      try {
        remote = await provider.getCheckout(checkoutId);
      } catch {
        continue;
      }
      const collected = collectedFromCheckout(remote);
      if (collected.unreadable || collected.currencyIssue || !collected.cents || collected.cents <= 0n) continue;
      const { error: settleError } = await admin.rpc("reconcile_checkout_total", {
        p_provider: "bachs",
        p_checkout_id: checkoutId,
        p_total_kes: collected.totalKes,
        p_tenant_id: attempt.tenant_id,
        p_invoice_id: attempt.invoice_id,
        p_raw: {},
      });
      if (settleError) continue;
      rows.push({
        kind: "checkout_total_settled",
        attemptId: attempt.id,
        invoiceId: attempt.invoice_id,
        paymentId: null,
        detail: checkoutId,
      });
    }
  }

  if (live) {
    const provider = payProviderFromEnv(process.env);
    const sweep = await sweepOpenCheckouts({
      env: process.env,
      async listAttempts() {
        const { data: openAttempts, error: listError } = await admin
          .from("payment_attempts")
          .select("tenant_id, invoice_id, checkout_session_id")
          .in("status", ["pending", "pending_unattached", "succeeded"])
          .not("checkout_session_id", "is", null);
        if (listError) throw listError;
        return (openAttempts || []).map((row) => ({
          tenantId: row.tenant_id,
          invoiceId: row.invoice_id,
          checkoutId: row.checkout_session_id,
        }));
      },
      getCheckout(checkoutId) {
        return provider.getCheckout(checkoutId);
      },
      async settleTotal(input) {
        const { data: settled, error: settleError } = await admin.rpc("reconcile_checkout_total", {
          p_provider: input.provider,
          p_checkout_id: input.checkoutId,
          p_total_kes: input.totalKes,
          p_tenant_id: input.tenantId,
          p_invoice_id: input.invoiceId,
          p_raw: input.raw || {},
        });
        if (settleError) throw settleError;
        return { noop: settled && settled.noop === true };
      },
    });
    rows.push(...sweep.rows);
  }

  if (live || bachsMode() === "sandbox") {
    const provider = payProviderFromEnv(process.env);
    const retry = await retryStoredReads({
      env: process.env,
      async listEvents() {
        const { data, error: listError } = await admin
          .from("payment_events")
          .select("event_key, payload")
          .eq("provider", "bachs")
          .eq("needs_retry", true);
        if (listError) throw listError;
        return (data || []).map((row) => ({ eventKey: String(row.event_key), payload: row.payload || {} }));
      },
      async clearRetry(eventKey) {
        const { error: clearError } = await admin.rpc("clear_payment_event_retry", {
          p_provider: "bachs",
          p_event_key: eventKey,
        });
        if (clearError) throw clearError;
      },
      async findAttempt(checkoutId) {
        const { data: attempt, error: attemptError } = await admin.rpc("invoice_pay_attempt_by_checkout", {
          p_checkout_id: checkoutId,
        });
        if (attemptError || !attempt) return null;
        return { tenantId: attempt.tenant_id, invoiceId: attempt.invoice_id };
      },
      getCheckout(checkoutId) {
        return provider.getCheckout(checkoutId);
      },
      async settle(input) {
        const { data: settled, error: settleError } = await admin.rpc("settle_checkout_reading", {
          p_provider: input.provider,
          p_checkout_id: input.checkoutId,
          p_total_kes: input.totalKes,
          p_tenant_id: input.tenantId,
          p_invoice_id: input.invoiceId,
          p_identity: input.identity,
          p_event_amount_kes: input.eventAmountKes,
          p_raw: input.raw || {},
          p_settled_amount_minor: input.settledAmountMinor,
          p_settled_currency: input.settledCurrency,
          p_fee_minor: input.feeMinor,
        });
        if (settleError) throw settleError;
        return { review: settled && settled.review === true, noop: settled && settled.noop === true };
      },
    });
    rows.push(...retry.rows);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: live ? "live-retry" : "sandbox",
    changed: rows.some((row) => row.kind === "checkout_total_settled" || row.kind === "retry_settled" || row.kind === "retry_review" || (row.kind === "sweep_settled" && row.noop !== true)),
    rows,
  }, null, 2));
}

main().catch((err) => {
  const message = err && err.code === "prod_refused" ? "refusing production database" : "reconciliation failed";
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
});
