import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminActorName } from "@/lib/adminActor";
import {
  adminTransferOwnership,
  sendOwnerPasswordReset,
  updateBusinessProfile,
} from "@/lib/adminBusinessProfile";
import {
  archiveBusiness,
  releaseBusinessNumber,
  restoreBusiness,
  suspendBusiness,
  unsuspendBusiness,
} from "@/lib/adminBusinessActions";
import { requestOrigin, resetPasswordRedirectUrl } from "@/lib/authCallback";
import { isAdminActionBlocked } from "@/lib/adminBusinessModel";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpGate } from "@/lib/ops/stepUpGate";
import { saveTenantRecordingRetentionOverride } from "@/lib/recordingRetentionAdmin";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = await request.json();
  const action = String(body.action || "");
  const businessId = String(body.business_id || "");

  if (!businessId) {
    return NextResponse.json({ error: "Pick a business first." }, { status: 400 });
  }

  const stepUp = await stepUpGate(gate.operator, `businesses:${action}`, businessId);
  if (stepUp) return stepUp;

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
      // Charging comes back only on an explicit "as before" choice (default off).
      const result = await restoreBusiness(businessId, actor, body.reason, body.resume_billing === true);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "update_profile") {
      const after = await updateBusinessProfile(businessId, actor, {
        business_name: body.business_name,
        whatsapp_notification_number: body.whatsapp_notification_number,
      });
      return NextResponse.json({ ok: true, ...after });
    }

    if (action === "send_owner_reset") {
      const origin = requestOrigin((name) => request.headers.get(name));
      const result = await sendOwnerPasswordReset(businessId, actor, resetPasswordRedirectUrl(origin));
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "transfer_owner") {
      await adminTransferOwnership(businessId, actor, String(body.user_id || ""));
      return NextResponse.json({ ok: true });
    }

    if (action === "save_recording_retention") {
      const before = { recording_retention_days_override: body.before_override ?? null };
      const value = await saveTenantRecordingRetentionOverride(
        businessId,
        body.recording_retention_days_override,
      );
      await recordAdminAction({
        actor,
        action: "save_recording_retention",
        businessId,
        before,
        after: { recording_retention_days_override: value },
      });
      return NextResponse.json({ ok: true, recording_retention_days_override: value });
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
