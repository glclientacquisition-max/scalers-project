import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
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
      logAdminError("wallets-ledger", err);
      return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
    }
  }

  try {
    const overview = await listAdminWallets();
    return NextResponse.json({ ok: true, ...overview });
  } catch (err) {
    logAdminError("wallets-list", err);
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

  // The signed-in Super Admin, never a typed name or a value from the request body.
  const actor = await adminActorName();
  const note = String(body.note || "").trim();

  try {
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
        betaExpiresAt: body.beta_expires_at ? String(body.beta_expires_at) : null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    logAdminError("wallets", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
