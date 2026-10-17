import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminActorName } from "@/lib/adminActor";
import {
  archiveBusiness,
  releaseBusinessNumber,
  restoreBusiness,
  suspendBusiness,
  unsuspendBusiness,
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
      await recordAdminAction({ actor, action: "assign_number", businessId, before: { number: null }, after: { number: data } });
      return NextResponse.json({ ok: true, e164: data });
    }

    if (action === "release_did") {
      const e164 = await releaseBusinessNumber(businessId, actor);
      return NextResponse.json({ ok: true, e164 });
    }

    if (action === "suspend") {
      await suspendBusiness(businessId, actor, body.reason);
      return NextResponse.json({ ok: true });
    }

    if (action === "unsuspend") {
      await unsuspendBusiness(businessId, actor, body.reason);
      return NextResponse.json({ ok: true });
    }

    if (action === "archive") {
      const result = await archiveBusiness(businessId, actor, body.reason);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "restore") {
      await restoreBusiness(businessId, actor, body.reason);
      return NextResponse.json({ ok: true });
    }

    // No hard delete from Admin ("remove" and "delete_permanently" are gone).
    // Archived data is purged by the nightly job after ARCHIVE_RESTORE_DAYS.
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (isAdminActionBlocked(err)) {
      return NextResponse.json({ error: err.message, blocked: true }, { status: 409 });
    }
    logAdminError("businesses", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
