import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { adminActorName } from "@/lib/adminActor";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { packageEditorWritesAllowed } from "@/lib/packageVersionEditor";
import { getSupabaseAdmin } from "@/lib/supabase";

const SAVE_FAILED = "That didn't save. Nothing changed.";

/**
 * Super Admin on/off for the two billing settings stored on this database.
 * Signup trial reuses admin_set_new_signup_trial. The package editor uses P18.
 * Both SQL functions write the billing audit row. Actor comes from the session.
 */
export async function POST(request: Request) {
  await requireSuperAdmin();
  if (!packageEditorWritesAllowed()) {
    return NextResponse.json({ error: "This change is not available here." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Confirm the change." }, { status: 400 });
  }
  const posted = body as { flag?: unknown; enabled?: unknown; reason?: unknown; confirm?: unknown };
  const flag = posted.flag === "package_editor" || posted.flag === "signup_trial" ? posted.flag : null;
  const reason = typeof posted.reason === "string" ? posted.reason.trim() : "";
  if (posted.confirm !== true) {
    return NextResponse.json({ error: "Confirm the change." }, { status: 400 });
  }
  if (!flag) {
    return NextResponse.json({ error: "Choose a setting." }, { status: 400 });
  }
  if (typeof posted.enabled !== "boolean") {
    return NextResponse.json({ error: "Choose on or off." }, { status: 400 });
  }
  if (reason.length < 3) {
    return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
  }

  const actor = await adminActorName();
  const admin = getSupabaseAdmin();
  const rpc =
    flag === "package_editor" ? "admin_set_package_editor_enabled" : "admin_set_new_signup_trial";
  const { error } = await admin.rpc(rpc, {
    p_enabled: posted.enabled,
    p_actor: actor,
    p_reason: reason,
    p_confirm: true,
  });
  if (error) {
    logAdminError("billing-flags", error);
    const text = String(error.message || "").toLowerCase();
    if (text.includes("package editor is off")) {
      return NextResponse.json({ error: "The package editor is off. Turn it on first." }, { status: 403 });
    }
    return NextResponse.json({ error: adminFacingError(error, SAVE_FAILED) }, { status: 400 });
  }

  await recordAdminAction({
    actor,
    action: flag === "package_editor" ? "set_package_editor_enabled" : "set_new_signup_trial",
    reason,
    after: { enabled: posted.enabled },
  });
  return NextResponse.json({ ok: true, enabled: posted.enabled });
}
