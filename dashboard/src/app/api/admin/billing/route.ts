import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import {
  grantTenantPackageMinutes,
  loadAdminBillingOverview,
  loadBillingHistory,
} from "@/lib/adminBilling";
import { isLegacyAuthenticated } from "@/lib/auth";
import { assignBusinessPackage, unassignBusinessPackage } from "@/lib/packageCatalog";
import {
  setTenantBillingMode,
  type BillingMode,
} from "@/lib/adminWallets";

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
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  const actor = String(body.actor || "ops").trim() || "ops";
  const note = String(body.note || "").trim();

  try {
    if (action === "grant_minutes") {
      const minutes = Number(body.minutes || 0);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return NextResponse.json({ error: "Enter a positive minute amount" }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Reason required (min 3 chars)" }, { status: 400 });
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
        return NextResponse.json({ error: "Package required" }, { status: 400 });
      }
      if (period !== "month" && period !== "year") {
        return NextResponse.json({ error: "Period must be month or year" }, { status: 400 });
      }
      const change = await assignBusinessPackage({
        tenantId: businessId,
        packageId,
        period,
        actor,
        note: note || undefined,
      });
      return NextResponse.json({ ok: true, ...change });
    }

    if (action === "unassign_package") {
      const when = String(body.when || "");
      if (when !== "now" && when !== "period_end") {
        return NextResponse.json({ error: "Choose now or end of period" }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Reason required (min 3 chars)" }, { status: 400 });
      }
      const result = await unassignBusinessPackage({ tenantId: businessId, when, note, actor });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "set_billing_mode") {
      const mode = String(body.mode || "") as BillingMode;
      if (mode !== "off" && mode !== "soft" && mode !== "hard") {
        return NextResponse.json({ error: "mode must be off|soft|hard" }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Reason required (min 3 chars)" }, { status: 400 });
      }
      const result = await setTenantBillingMode({
        businessId,
        mode,
        note,
        actor,
        betaExpiresAt: body.beta_expires_at ? String(body.beta_expires_at) : null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    logAdminError("billing", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
