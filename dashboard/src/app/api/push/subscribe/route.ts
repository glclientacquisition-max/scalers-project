import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ownerTenantId } from "@/lib/tenant";
import { parseEndpointOnly, parsePushSubscription } from "@/lib/pushSubscribe";

/**
 * Phone alerts: save (POST) or remove (DELETE) this device's push subscription.
 * Owner login only (Supabase session; the shared admin password is refused).
 * Writes use the service role, scoped to the signed-in user, so a device that moves between
 * two accounts is re-owned by upsert on endpoint. Table: docs/supabase/push_subscriptions.sql.
 */
async function signedInOwner() {
  const user = await getAuthUser();
  if (!user) return null;
  const tenantId = await ownerTenantId(await createSupabaseServerClient(), user.id);
  if (!tenantId) return null;
  return { userId: user.id, tenantId };
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const who = await signedInOwner();
  if (!who) return noStore({ error: "unauthorized" }, 401);
  const { data, error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .select("id, endpoint, platform, device_label, created_at, last_ok_at, disabled_at")
    .eq("user_id", who.userId)
    .eq("tenant_id", who.tenantId)
    .order("created_at", { ascending: false });
  if (error) return noStore({ error: "unavailable", devices: [] }, 503);
  return noStore({ devices: data || [] });
}

export async function POST(request: Request) {
  const who = await signedInOwner();
  if (!who) return noStore({ error: "unauthorized" }, 401);
  const input = parsePushSubscription(await request.json().catch(() => null));
  if (!input) return noStore({ error: "invalid subscription" }, 400);
  const { error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .upsert(
      {
        ...input,
        provider: "webpush",
        user_id: who.userId,
        tenant_id: who.tenantId,
        fail_count: 0,
        disabled_at: null,
      },
      { onConflict: "endpoint" }
    );
  if (error) return noStore({ error: "could not save" }, 503);
  return noStore({ ok: true });
}

export async function DELETE(request: Request) {
  const who = await signedInOwner();
  if (!who) return noStore({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const endpoint = parseEndpointOnly(body);
  const id = body && typeof body.id === "string" ? body.id : null;
  if (!endpoint && !id) return noStore({ error: "endpoint or id required" }, 400);
  let q = getSupabaseAdmin().from("push_subscriptions").delete().eq("user_id", who.userId);
  q = endpoint ? q.eq("endpoint", endpoint) : q.eq("id", id as string);
  const { error } = await q;
  if (error) return noStore({ error: "could not remove" }, 503);
  return noStore({ ok: true });
}
