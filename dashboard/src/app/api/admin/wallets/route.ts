import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  adjustTenantWalletSecure,
  listAdminWallets,
  listTenantLedger,
  setTenantBillingMode,
  type BillingMode,
} from "@/lib/adminWallets";

export async function GET(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const ledgerFor = searchParams.get("ledger_for");
  if (ledgerFor) {
    try {
      const ledger = await listTenantLedger(ledgerFor);
      return NextResponse.json({ ok: true, ledger });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const overview = await listAdminWallets();
    return NextResponse.json({ ok: true, ...overview });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
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
    if (action === "adjust_wallet") {
      const deltaKes = Number(body.delta_kes || 0);
      if (!Number.isFinite(deltaKes) || deltaKes === 0) {
        return NextResponse.json({ error: "Enter a non-zero KES amount" }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Note required (why you are adjusting)" }, { status: 400 });
      }
      const result = await adjustTenantWalletSecure({
        businessId,
        deltaKes,
        note,
        actor,
        idempotencyKey: String(body.idempotency_key || "").trim() || undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "set_billing_mode") {
      const mode = String(body.mode || "") as BillingMode;
      if (mode !== "off" && mode !== "soft" && mode !== "hard") {
        return NextResponse.json({ error: "mode must be off|soft|hard" }, { status: 400 });
      }
      if (note.length < 3) {
        return NextResponse.json({ error: "Note required" }, { status: 400 });
      }
      const result = await setTenantBillingMode({
        businessId,
        mode,
        note,
        actor,
        waiveNegative: Boolean(body.waive_negative),
        betaExpiresAt: body.beta_expires_at ? String(body.beta_expires_at) : null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /function|schema cache|set_tenant_billing_mode|adjust_tenant_wallet/i.test(message)
      ? " Apply docs/supabase/wallet_security_beta.sql in Supabase."
      : "";
    return NextResponse.json({ error: `${message}${hint}` }, { status: 500 });
  }
}
