import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { adminActorName } from "@/lib/adminActor";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  packageEditorWritesAllowed,
  packageVersionEditorHttpStatus,
  parseEditorCommand,
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

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
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
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!packageEditorWritesAllowed()) {
    return NextResponse.json({ error: "package_editor_staging_only" }, { status: 403 });
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

  const actor = await adminActorName();
  try {
    const result = await runEditorCommand(actor, parsed.command);
    return NextResponse.json({ ok: true, ...(result as object) });
  } catch (err) {
    logAdminError("package-versions", err);
    const facing = adminFacingError(err);
    const mapped = packageVersionEditorHttpStatus(facing);
    if (!mapped) return NextResponse.json({ error: facing }, { status: 500 });
    return NextResponse.json({ error: mapped.error, message: facing }, { status: mapped.status });
  }
}
