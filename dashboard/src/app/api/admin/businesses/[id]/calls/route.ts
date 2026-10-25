import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only: the last 10 calls for one business, for the Businesses pane. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isLegacyAuthenticated())) return NextResponse.json({ error: "ops_only" }, { status: 403 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "business id required" }, { status: 400 });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("calls")
      .select("id, created_at, duration_seconds, primary_intent, status")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return NextResponse.json({ calls: data || [] });
  } catch (err) {
    logAdminError("business-calls", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
