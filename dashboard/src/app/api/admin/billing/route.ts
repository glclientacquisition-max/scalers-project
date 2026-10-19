import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import {
  grantTenantPackageMinutes,
  loadAdminBillingOverview,
  loadBillingHistory,
  resolveCheckoutTotalReview,
} from "@/lib/adminBilling";
import { isLegacyAuthenticated } from "@/lib/auth";
import { recordAdminAction } from "@/lib/adminAudit";
import { assignBusinessPackage, loadBusinessPackageNames, unassignBusinessPackage } from "@/lib/packageCatalog";
import {
  confirmTenantBillingMode,
  type BillingMode,
} from "@/lib/adminWallets";

/** Shown when a write fails for a reason the operator can't act on. The raw cause goes to the log. */
const SAVE_FAILED = "That didn't save. Nothing changed. Try again, or check Activity.";

export async function GET(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
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
      if (!providerRef.startsWith("checkout-total-review:")) {
        return NextResponse.json({ error: "That review is not on this business." }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
      }
      await resolveCheckoutTotalReview({
        businessId,
        providerRef,
        actor,
        reason: note,
      });
      return NextResponse.json({ ok: true });
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
