import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { removeBusinessAndReleaseDid, releaseDidFromBusiness } from "@/lib/admin";

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

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
