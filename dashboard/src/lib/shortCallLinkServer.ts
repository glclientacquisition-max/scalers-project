import "server-only";

import { cookies } from "next/headers";
import { getAuthUser } from "@/lib/auth";
import { DESK_TENANT_COOKIE } from "@/lib/deskTenantCookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberRowsForUser } from "@/lib/tenant";
import { decideShortCallLink, normalizeShortCode, type ShortLinkCall, type ShortLinkDecision } from "@/lib/shortCallLink";

/**
 * Resolve /c/<code> for the signed-in person. The call is read with their own
 * session (RLS), then membership of the call's tenant is checked again here.
 * Any read error (including calls.short_code not migrated yet) is not found.
 */
export async function resolveShortCallLink(raw: unknown): Promise<ShortLinkDecision> {
  const code = normalizeShortCode(raw);
  const user = code ? await getAuthUser() : null;
  if (!code || !user) return decideShortCallLink({ code, signedIn: Boolean(user), call: null, memberTenantIds: [] });

  let call: ShortLinkCall = null;
  let memberTenantIds: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("calls").select("id, tenant_id").eq("short_code", code).maybeSingle();
    if (!error && data?.id && data?.tenant_id) call = { id: String(data.id), tenant_id: String(data.tenant_id) };
    if (call) memberTenantIds = (await memberRowsForUser(user.id)).map((r) => r.tenant_id);
  } catch {
    call = null;
  }
  const picked = (await cookies()).get(DESK_TENANT_COOKIE)?.value || "";
  const currentTenantId = memberTenantIds.includes(picked) ? picked : memberTenantIds[0] || null;
  return decideShortCallLink({ code, signedIn: true, call, memberTenantIds, currentTenantId });
}
