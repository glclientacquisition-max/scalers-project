import { stepUpGateSession } from "@/lib/ops/stepUpGate";
import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { adminActorName } from "@/lib/adminActor";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  packageEditorActivityEntries,
  packageVersionEditorHttpStatus,
  parseEditorCommand,
  type EditorActivityBefore,
  type EditorBusinessSnap,
  type EditorCommand,
} from "@/lib/packageVersionEditor";
import { getSupabaseAdmin } from "@/lib/supabase";

async function callEditor(name: string, args: Record<string, unknown>) {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);
  if (error) throw error;
  return data;
}

/** Actor comes from the signed-in Super Admin session, never from the body. */
async function runEditorCommand(actor: string, command: EditorCommand) {
  switch (command.action) {
    case "draft":
      return callEditor("admin_draft_package_version", {
        p_sku: command.sku,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "update_draft":
      return callEditor("admin_update_package_version_draft", {
        p_version_id: command.versionId,
        p_patch: command.patch,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "publish":
      return callEditor("admin_publish_package_version", {
        p_version_id: command.versionId,
        p_active_from: command.activeFrom,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "archive":
      return callEditor("admin_archive_package_version", {
        p_version_id: command.versionId,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "discard_draft":
      return callEditor("admin_discard_package_version_draft", {
        p_version_id: command.versionId,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "approve":
      return callEditor("admin_approve_package_version", {
        p_version_id: command.versionId,
        p_actor: actor,
        p_reason: command.reason,
      });
    case "move_subscribers":
      return callEditor("admin_move_subscribers_to_package_version", {
        p_version_id: command.versionId,
        p_tenant_ids: command.tenantIds,
        p_actor: actor,
        p_reason: command.reason,
        p_confirm: command.confirm,
      });
    case "set_billing_mode":
      return callEditor("admin_set_tenant_billing_mode", {
        p_tenant_id: command.tenantId,
        p_billing_status: command.billingStatus,
        p_enforcement: command.enforcement,
        p_actor: actor,
        p_reason: command.reason,
        p_confirm: command.confirm,
      });
    case "set_new_signup_trial":
      return callEditor("admin_set_new_signup_trial", {
        p_enabled: command.enabled,
        p_actor: actor,
        p_reason: command.reason,
        p_confirm: command.confirm,
      });
    case "set_price_approval_threshold":
      return callEditor("admin_set_price_approval_threshold", {
        p_threshold: command.thresholdKes,
        p_actor: actor,
        p_reason: command.reason,
      });
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

const VERSION_COLUMNS =
  "id, version, status, monthly_price_kes, annual_price_kes, minutes, seats, message_credits, dids, inbound_kes_per_second, outbound_kes_per_second, credit_kes, trial_days, on_demand_allowed, package_id";

async function loadVersionSnap(versionId: string): Promise<Record<string, unknown> | null> {
  const admin = getSupabaseAdmin();
  let res = await admin
    .from("billing_package_versions")
    .select(`${VERSION_COLUMNS}, extra_seat_monthly_kes`)
    .eq("id", versionId)
    .maybeSingle();
  if (res.error) {
    res = await admin.from("billing_package_versions").select(VERSION_COLUMNS).eq("id", versionId).maybeSingle();
  }
  if (res.error) throw res.error;
  if (!res.data) return null;
  const row = res.data as Record<string, unknown>;
  const packageId = typeof row.package_id === "string" ? row.package_id : "";
  if (!packageId) return row;
  const pack = await admin.from("billing_packages").select("sku, name").eq("id", packageId).maybeSingle();
  if (pack.error || !pack.data) return row;
  return { ...row, sku: pack.data.sku, name: pack.data.name };
}

async function loadBusinessSnaps(ids: string[]): Promise<EditorBusinessSnap[]> {
  if (!ids.length) return [];
  const admin = getSupabaseAdmin();
  const [tenants, subs] = await Promise.all([
    admin.from("tenants").select("id, business_name, billing_enforcement, minutes_included").in("id", ids),
    admin.from("tenant_subscriptions").select("tenant_id, billing_status, package_version_id").in("tenant_id", ids),
  ]);
  if (tenants.error) throw tenants.error;
  if (subs.error) throw subs.error;
  const subById = new Map((subs.data || []).map((row) => [row.tenant_id, row]));
  return (tenants.data || []).map((row) => {
    const sub = subById.get(row.id);
    return {
      id: row.id,
      business_name: row.business_name,
      billing_enforcement: row.billing_enforcement,
      minutes_included: row.minutes_included,
      billing_status: sub?.billing_status ?? null,
      package_version_id: sub?.package_version_id ?? null,
    };
  });
}

/** A failed pre-read must not block the write. Activity then records the action without a before. */
async function loadEditorBefore(command: EditorCommand): Promise<EditorActivityBefore> {
  try {
    if (
      command.action === "update_draft" ||
      command.action === "publish" ||
      command.action === "archive" ||
      command.action === "discard_draft" ||
      command.action === "approve"
    ) {
      return { version: await loadVersionSnap(command.versionId) };
    }
    if (command.action === "move_subscribers") {
      return { businesses: await loadBusinessSnaps(command.tenantIds) };
    }
    if (command.action === "set_billing_mode") {
      return { businesses: await loadBusinessSnaps([command.tenantId]) };
    }
    if (command.action === "set_new_signup_trial" || command.action === "set_price_approval_threshold") {
      const { data, error } = await getSupabaseAdmin()
        .from("billing_lifecycle_settings")
        .select("new_signup_trial_enabled, price_change_approval_threshold_kes")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return {
        signupEnabled: data?.new_signup_trial_enabled ?? null,
        thresholdKes: data?.price_change_approval_threshold_kes ?? null,
      };
    }
  } catch (err) {
    logAdminError("package-versions-before", err);
  }
  return {};
}

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json(
      { error: "ops_only", message: "Super Admin only." },
      { status: 403 },
    );
  }
  try {
    const catalog = await callEditor("admin_list_package_versions", {});
    return NextResponse.json({ ok: true, ...(catalog as object) });
  } catch (err) {
    logAdminError("package-versions-list", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json(
      { error: "ops_only", message: "Super Admin only." },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid", message: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = parseEditorCommand(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", message: parsed.error }, { status: 400 });
  }

  const stepUp = await stepUpGateSession(`package-versions:${parsed.command.action}`, null);
  if (stepUp) return stepUp;

  const actor = await adminActorName();
  try {
    const before = await loadEditorBefore(parsed.command);
    const result = await runEditorCommand(actor, parsed.command);
    for (const entry of packageEditorActivityEntries(parsed.command, result, before)) {
      await recordAdminAction({ actor, ...entry });
    }
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (err) {
    logAdminError("package-versions", err);
    const facing = adminFacingError(err);
    const mapped = packageVersionEditorHttpStatus(facing);
    if (!mapped) return NextResponse.json({ error: facing }, { status: 500 });
    return NextResponse.json({ error: mapped.error, message: facing }, { status: mapped.status });
  }
}
