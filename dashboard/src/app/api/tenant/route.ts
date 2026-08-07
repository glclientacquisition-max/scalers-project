import { NextResponse } from "next/server";
import { isAuthenticated, isLegacyAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const tenant = await getCurrentTenant();
  if (!tenant || tenant.id !== id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.business_name === "string") patch.business_name = body.business_name.trim();
  if (typeof body.whatsapp_notification_number === "string") {
    patch.whatsapp_notification_number = body.whatsapp_notification_number.trim();
  }
  if (typeof body.llm_system_prompt === "string") {
    patch.llm_system_prompt = body.llm_system_prompt;
  }

  // Owners update via JWT + RLS. Legacy Super Admin desk keeps service role.
  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await workspace.client
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select("id, business_name, whatsapp_notification_number, llm_system_prompt")
    .single();

  if (error) {
    const hint =
      /row-level security|permission denied|rls/i.test(error.message) &&
      !(await isLegacyAuthenticated())
        ? " Apply docs/supabase/owner_rls.sql in Supabase."
        : "";
    return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tenant: data, mode: workspace.mode });
}
