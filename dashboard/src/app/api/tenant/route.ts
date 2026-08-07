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

  // Raw llm_system_prompt edits are disabled — use saveAndCompileSettings /
  // onboarding so Gemini compiles structured fields into the voice prompt.
  const patch: Record<string, unknown> = {};
  if (typeof body.business_name === "string") patch.business_name = body.business_name.trim();
  if (typeof body.whatsapp_notification_number === "string") {
    patch.whatsapp_notification_number = body.whatsapp_notification_number.trim();
  }
  if (typeof body.services_offered === "string") {
    patch.services_offered = body.services_offered.trim();
  }
  if (typeof body.business_hours === "string") {
    patch.business_hours = body.business_hours.trim();
  }
  if (typeof body.agent_tone === "string") {
    patch.agent_tone = body.agent_tone.trim();
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
    .select(
      "id, business_name, whatsapp_notification_number, services_offered, business_hours, agent_tone"
    )
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
