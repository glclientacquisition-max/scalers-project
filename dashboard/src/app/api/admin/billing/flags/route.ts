import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { adminActorName } from "@/lib/adminActor";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";

const SAVE_FAILED = "That didn't save. Nothing changed.";

type DbFlag = "package_editor" | "signup_trial";
type RuntimeFlag = "bachs_mode" | "live_master" | "billing_notices" | "desk_plan_change";
type BachsMode = "off" | "sandbox" | "live";

const RUNTIME_RPC: Record<RuntimeFlag, string> = {
  bachs_mode: "bachs_mode",
  live_master: "live_master",
  billing_notices: "billing_notices",
  desk_plan_change: "desk_plan_change",
};

function isDbFlag(value: unknown): value is DbFlag {
  return value === "package_editor" || value === "signup_trial";
}

function isRuntimeFlag(value: unknown): value is RuntimeFlag {
  return (
    value === "bachs_mode" ||
    value === "live_master" ||
    value === "billing_notices" ||
    value === "desk_plan_change"
  );
}

function isBachsMode(value: unknown): value is BachsMode {
  return value === "off" || value === "sandbox" || value === "live";
}

/**
 * Super Admin billing switches on this database.
 * Package editor and signup trial use P18 RPCs. Payment runtime uses P20.
 */
export async function POST(request: Request) {
  await requireSuperAdmin();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Confirm the change." }, { status: 400 });
  }
  const posted = body as {
    flag?: unknown;
    enabled?: unknown;
    mode?: unknown;
    reason?: unknown;
    confirm?: unknown;
  };
  const reason = typeof posted.reason === "string" ? posted.reason.trim() : "";
  if (posted.confirm !== true) {
    return NextResponse.json({ error: "Confirm the change." }, { status: 400 });
  }
  if (reason.length < 3) {
    return NextResponse.json({ error: "Add a reason (3 letters or more)." }, { status: 400 });
  }

  const actor = await adminActorName();
  const admin = getSupabaseAdmin();

  if (isDbFlag(posted.flag)) {
    if (typeof posted.enabled !== "boolean") {
      return NextResponse.json({ error: "Choose on or off." }, { status: 400 });
    }
    const rpc =
      posted.flag === "package_editor" ? "admin_set_package_editor_enabled" : "admin_set_new_signup_trial";
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
      action: posted.flag === "package_editor" ? "set_package_editor_enabled" : "set_new_signup_trial",
      reason,
      after: { enabled: posted.enabled },
    });
    return NextResponse.json({ ok: true, enabled: posted.enabled });
  }

  if (isRuntimeFlag(posted.flag)) {
    const pSwitch = RUNTIME_RPC[posted.flag];
    let pMode: string | null = null;
    let pEnabled: boolean | null = null;
    if (posted.flag === "bachs_mode") {
      if (!isBachsMode(posted.mode)) {
        return NextResponse.json({ error: "Choose off, sandbox, or live." }, { status: 400 });
      }
      pMode = posted.mode;
    } else if (typeof posted.enabled === "boolean") {
      pEnabled = posted.enabled;
    } else {
      return NextResponse.json({ error: "Choose on or off." }, { status: 400 });
    }

    const { data, error } = await admin.rpc("admin_set_billing_runtime_switch", {
      p_switch: pSwitch,
      p_mode: pMode,
      p_enabled: pEnabled,
      p_actor: actor,
      p_reason: reason,
      p_confirm: true,
    });
    if (error) {
      logAdminError("billing-runtime-flag", error);
      const text = String(error.message || "").toLowerCase();
      if (text.includes("does not exist") || text.includes("unknown switch")) {
        return NextResponse.json(
          { error: "Payment switches are not on this database yet. Apply the P20 migration first." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: adminFacingError(error, SAVE_FAILED) }, { status: 400 });
    }

    await recordAdminAction({
      actor,
      action: "set_billing_runtime_switch",
      reason,
      after: data,
      detail: { switch: posted.flag },
    });
    return NextResponse.json({ ok: true, settings: data });
  }

  return NextResponse.json({ error: "Choose a setting." }, { status: 400 });
}
