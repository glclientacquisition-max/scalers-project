import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAuthenticated } from "@/lib/auth";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.business_name === "string") patch.business_name = body.business_name.trim();
  if (typeof body.whatsapp_notification_number === "string") {
    patch.whatsapp_notification_number = body.whatsapp_notification_number.trim();
  }
  if (typeof body.llm_system_prompt === "string") {
    patch.llm_system_prompt = body.llm_system_prompt;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", id)
    .select("id, business_name, whatsapp_notification_number, llm_system_prompt")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tenant: data });
}
