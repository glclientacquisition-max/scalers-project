import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import {
  archiveBusiness,
  deleteArchivedBusiness,
  releaseBusinessNumber,
  restoreBusiness,
} from "@/lib/adminBusinessActions";
import { isAdminActionBlocked } from "@/lib/adminBusinessModel";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  // The signed-in Super Admin, never a name from the request body.
  const actor = await adminActorName();

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
      const e164 = await releaseBusinessNumber(businessId, actor);
      return NextResponse.json({ ok: true, e164 });
    }

    if (action === "archive") {
      const reason = String(body.reason || "").trim();
      const result = await archiveBusiness(businessId, actor, reason);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "restore") {
      await restoreBusiness(businessId, actor);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_permanently") {
      const e164 = await deleteArchivedBusiness(businessId, actor, String(body.confirm_name || ""));
      return NextResponse.json({ ok: true, e164 });
    }

    // "remove" (hard delete in one step) is gone: Archive, then permanent delete after the grace period.
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (isAdminActionBlocked(err)) {
      return NextResponse.json({ error: err.message, blocked: true }, { status: 409 });
    }
    logAdminError("businesses", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
