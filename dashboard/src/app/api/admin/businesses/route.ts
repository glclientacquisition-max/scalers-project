import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  adjustTenantWallet,
  removeBusinessAndReleaseDid,
  releaseDidFromBusiness,
} from "@/lib/admin";

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

  try {
    if (action === "assign_next") {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.rpc("assign_did_from_pool", {
        p_tenant_id: businessId,
      });
      if (error) throw error;
      if (!data) {
        return NextResponse.json({ error: "No available numbers in the pool" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, e164: data });
    }

    if (action === "release_did") {
      const e164 = await releaseDidFromBusiness(businessId);
      return NextResponse.json({ ok: true, e164 });
    }

    if (action === "remove") {
      const e164 = await removeBusinessAndReleaseDid(businessId);
      return NextResponse.json({ ok: true, e164 });
    }

    if (action === "adjust_wallet") {
      const telecomDeltaKes = Number(body.telecom_delta_kes || 0);
      const aiDeltaUsd = Number(body.ai_delta_usd || 0);
      if (!Number.isFinite(telecomDeltaKes) || !Number.isFinite(aiDeltaUsd)) {
        return NextResponse.json({ error: "Invalid wallet deltas" }, { status: 400 });
      }
      if (telecomDeltaKes === 0 && aiDeltaUsd === 0) {
        return NextResponse.json({ error: "Enter a non-zero amount" }, { status: 400 });
      }
      const wallets = await adjustTenantWallet({
        businessId,
        telecomDeltaKes,
        aiDeltaUsd,
        note: String(body.note || "").trim() || undefined,
      });
      return NextResponse.json({ ok: true, ...wallets });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /adjust_tenant_wallet|function/i.test(message)
      ? " Apply docs/supabase/wallet_metering.sql in Supabase."
      : "";
    return NextResponse.json({ error: `${message}${hint}` }, { status: 500 });
  }
}
