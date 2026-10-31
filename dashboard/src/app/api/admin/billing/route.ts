import { stepUpGateSession } from "@/lib/ops/stepUpGate";
import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import {
  grantTenantPackageMinutes,
  loadAdminBillingOverview,
  loadBillingHistory,
  loadCheckoutReviewReading,
  resolveCheckoutTotalReview,
  waivePeriodOverage,
} from "@/lib/adminBilling";
import { loadAdminShopInvoices, mintAdminInvoicePayLink } from "@/lib/adminBillingInvoices";
import { bookTotalForResolve, collectedFromCheckout } from "@/lib/invoicePay/webhook";
import { effectivePaymentEnv } from "@/lib/billingRuntimeSettings";
import { assertLiveTenant, bachsMode, paymentsClosed, payProviderFromEnv } from "@/lib/invoicePay/provider";
import { isLegacyAuthenticated } from "@/lib/auth";
import { recordAdminAction } from "@/lib/adminAudit";
import { assignBusinessPackage, loadBusinessPackageNames, unassignBusinessPackage } from "@/lib/packageCatalog";
import {
  confirmTenantBillingMode,
  type BillingMode,
} from "@/lib/adminWallets";

/** Shown when a write fails for a reason the operator can't act on. The raw cause goes to the log. */
const SAVE_FAILED = "That didn't save. Nothing changed. Try again, or check Activity.";
const UNREAD_COLLECTED = "Couldn't read the collected amount. Nothing changed.";

type BookDecision = { ok: true; totalKes: string } | { ok: false; error: string };

/** The helper is plain JS, so its `ok` flag is a boolean until we narrow it. */
function decidedBook(raw: { ok: boolean; totalKes?: string; error?: string }): BookDecision {
  if (raw.ok === true && typeof raw.totalKes === "string" && raw.totalKes !== "") {
    return { ok: true, totalKes: raw.totalKes };
  }
  return { ok: false, error: typeof raw.error === "string" && raw.error ? raw.error : UNREAD_COLLECTED };
}

/**
 * Book uses a live GET only when the gate is open. A closed gate, including
 * an allowlist refusal, books the stored reading and does not call Bachs.
 */
async function totalForBookedResolve(
  businessId: string,
  reading: { getKes: string; checkoutId: string },
): Promise<BookDecision> {
  const paymentEnv = await effectivePaymentEnv();
  const liveOpen = bachsMode(paymentEnv) === "live" && !paymentsClosed(paymentEnv);
  if (!liveOpen) return decidedBook(bookTotalForResolve({ live: false, storedKes: reading.getKes }));
  try {
    await assertLiveTenant(businessId, paymentEnv);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code || "") : "";
    if (code === "bachs_live_refused") {
      return decidedBook(bookTotalForResolve({ live: false, storedKes: reading.getKes }));
    }
    throw err;
  }
  if (!reading.checkoutId) return { ok: false, error: UNREAD_COLLECTED };
  let row = null;
  try {
    row = await payProviderFromEnv(paymentEnv).getCheckout(reading.checkoutId);
  } catch {
    return { ok: false, error: UNREAD_COLLECTED };
  }
  return decidedBook(bookTotalForResolve({
    live: true,
    storedKes: reading.getKes,
    fresh: collectedFromCheckout(row),
  }));
}

export async function GET(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const invoicesFor = searchParams.get("invoices_for");
  if (invoicesFor) {
    try {
      const loaded = await loadAdminShopInvoices(invoicesFor);
      if (!loaded.ok) {
        return NextResponse.json({ error: "Could not load invoices." }, { status: 500 });
      }
      return NextResponse.json({ ok: true, missing: loaded.missing, invoices: loaded.invoices });
    } catch (err) {
      logAdminError("billing-invoices", err);
      return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
    }
  }

  const historyFor = searchParams.get("history_for");
  if (historyFor) {
    try {
      const history = await loadBillingHistory(historyFor);
      return NextResponse.json({ ok: true, history });
    } catch (err) {
      logAdminError("billing-history", err);
      return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
    }
  }

  try {
    const overview = await loadAdminBillingOverview();
    return NextResponse.json({ ok: true, ...overview });
  } catch (err) {
    logAdminError("billing-list", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const body = await request.json();
  const action = String(body.action || "");
  const businessId = String(body.business_id || "");
  if (!businessId) {
    return NextResponse.json({ error: "Pick a business first." }, { status: 400 });
  }

  const stepUp = await stepUpGateSession(`billing:${action}`, businessId);
  if (stepUp) return stepUp;

  // The signed-in Super Admin, never a typed name or a value from the request body.
  const actor = await adminActorName();
  const note = String(body.note || "").trim();

  try {
    if (action === "grant_minutes") {
      const minutes = Number(body.minutes || 0);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return NextResponse.json({ error: "Enter how many minutes to grant." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      const result = await grantTenantPackageMinutes({
        businessId,
        minutes: Math.floor(minutes),
        note,
        actor,
        idempotencyKey: String(body.idempotency_key || "").trim() || undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "waive_period_overage") {
      if (body.confirm !== true) {
        return NextResponse.json({ error: "Confirm the waiver first." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      const idempotencyKey = String(body.idempotency_key || "").trim();
      if (!idempotencyKey) {
        return NextResponse.json({ error: "Open the waiver again and retry." }, { status: 400 });
      }
      const result = await waivePeriodOverage({ businessId, reason: note, actor, idempotencyKey });
      return NextResponse.json({ ok: true, waived_kes: result.waivedKes, replay: result.replay });
    }

    if (action === "assign_package") {
      const packageId = String(body.package_id || "");
      const period = String(body.period || "month");
      if (!packageId) {
        return NextResponse.json({ error: "Pick a package." }, { status: 400 });
      }
      if (period !== "month" && period !== "year") {
        return NextResponse.json({ error: "Pick monthly or yearly." }, { status: 400 });
      }
      const before = (await loadBusinessPackageNames().catch(() => null))?.get(businessId) ?? null;
      const change = await assignBusinessPackage({
        tenantId: businessId,
        packageId,
        period,
        actor,
        note: note || undefined,
      });
      const after = (await loadBusinessPackageNames().catch(() => null))?.get(businessId) ?? { packageId, period };
      await recordAdminAction({ actor, action: "assign_package", businessId, before, after });
      return NextResponse.json({ ok: true, ...change });
    }

    if (action === "unassign_package") {
      const when = String(body.when || "");
      if (when !== "now" && when !== "period_end") {
        return NextResponse.json({ error: "Pick now or the end of the period." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      const before = (await loadBusinessPackageNames().catch(() => null))?.get(businessId) ?? null;
      const result = await unassignBusinessPackage({ tenantId: businessId, when, note, actor });
      await recordAdminAction({ actor, action: "unassign_package", businessId, before, after: { when, ...result } });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "resolve_checkout_review") {
      const providerRef = String(body.provider_ref || "").trim();
      const choice = String(body.choice || "").trim();
      if (!providerRef.startsWith("checkout-total-review:")) {
        return NextResponse.json({ error: "That review is not on this business." }, { status: 400 });
      }
      if (choice !== "book" && choice !== "nothing") {
        return NextResponse.json({ error: "Choose book collected amount or nothing collected." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      let totalKes: string | undefined;
      if (choice === "book") {
        const reading = await loadCheckoutReviewReading({ businessId, providerRef });
        const decision = await totalForBookedResolve(businessId, reading);
        if (!decision.ok) {
          return NextResponse.json({ error: decision.error }, { status: 400 });
        }
        totalKes = decision.totalKes;
      }
      await resolveCheckoutTotalReview({
        businessId,
        providerRef,
        actor,
        reason: note,
        choice,
        totalKes,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "mint_pay_link") {
      const invoiceId = String(body.invoice_id || "");
      if (!invoiceId) {
        return NextResponse.json({ error: "Pick an invoice." }, { status: 400 });
      }
      const minted = await mintAdminInvoicePayLink(invoiceId, businessId);
      if ("error" in minted) {
        return NextResponse.json({ error: minted.error }, { status: 400 });
      }
      await recordAdminAction({
        actor,
        action: "mint_pay_link",
        businessId,
        before: null,
        after: { invoice_id: invoiceId },
      });
      return NextResponse.json({ ok: true, pay_path: minted.payPath });
    }

    if (action === "set_billing_mode") {
      const mode = String(body.mode || "") as BillingMode;
      if (mode !== "off" && mode !== "soft" && mode !== "hard") {
        return NextResponse.json({ error: "Pick a charging mode." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      const result = await confirmTenantBillingMode({
        businessId,
        mode,
        note,
        actor,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "That action isn't available." }, { status: 400 });
  } catch (err) {
    logAdminError("billing", err);
    return NextResponse.json({ error: adminFacingError(err, SAVE_FAILED) }, { status: 500 });
  }
}
