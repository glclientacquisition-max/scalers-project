import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { addDidToPool, listDidPool, listPendingTenants, normalizeE164 } from "@/lib/didPool";

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  try {
    const [pool, pendingBusinesses] = await Promise.all([listDidPool(), listPendingTenants()]);
    return NextResponse.json({ pool, pendingBusinesses, pendingTenants: pendingBusinesses });
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
  const action = String(body.action || "add");

  try {
    if (action === "add") {
      const row = await addDidToPool({
        e164: String(body.e164 || ""),
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({ ok: true, row });
    }

    if (action === "assign_next") {
      const tenantId = String(body.tenant_id || "");
      if (!tenantId) {
        return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
      }
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.rpc("assign_did_from_pool", {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { error: "No available DIDs in the pool" },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true, e164: data });
    }

    if (action === "assign_specific") {
      const tenantId = String(body.tenant_id || "");
      const e164 = normalizeE164(String(body.e164 || ""));
      if (!tenantId || !e164) {
        return NextResponse.json({ error: "tenant_id and e164 required" }, { status: 400 });
      }
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.rpc("assign_specific_did_to_tenant", {
        p_tenant_id: tenantId,
        p_e164: e164,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, e164: data });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
