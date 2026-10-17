import type { SupabaseClient } from "@supabase/supabase-js";
import { sendBlock, type SendBlock, type TenantLineRow } from "@/lib/tenantLineState";

/**
 * Line state for one business: is_active, archived_at, line_status. Newer columns drop out on
 * older schemas. A failed read fails open (returns null = open), like the voice gate, so a
 * database blip never blocks a live business.
 */
const LINE_SELECTS = ["is_active, archived_at, line_status", "is_active, archived_at", "is_active"];

export async function loadTenantLine(client: SupabaseClient, tenantId: string): Promise<TenantLineRow | null> {
  if (!tenantId) return null;
  for (const columns of LINE_SELECTS) {
    const { data, error } = await client.from("tenants").select(columns).eq("id", tenantId).maybeSingle();
    if (!error) return (data as unknown as TenantLineRow | null) || null;
    if (!/archived_at|line_status|column|42703|PGRST204/i.test(`${error.message} ${error.code || ""}`)) {
      console.warn("[tenant line] read failed, sending allowed", error.message);
      return null;
    }
  }
  return null;
}

/** Why this business can't send to callers or teammates right now, or null. Runs before any ledger or charge. */
export async function outboundSendBlock(client: SupabaseClient, tenantId: string): Promise<SendBlock | null> {
  return sendBlock(await loadTenantLine(client, tenantId));
}
