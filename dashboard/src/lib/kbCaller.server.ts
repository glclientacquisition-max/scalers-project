import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { KbCategory } from "@/lib/kbCore";
import { kbCallerRow } from "@/lib/kbCaller";
import { loadKbItems } from "@/lib/kbWrite.server";

const PROJECTED = new WeakSet<object>();

/**
 * The tenant row as a caller-facing reader sees it (kbCaller.ts): a KB business gets offered items only and no
 * old services text. No KB tables or no offered items (prod today): the stored row, unchanged.
 * Callers authorize first; this uses the service role. Safe to call twice on the same row.
 */
export async function loadKbCallerRow<T extends { id: string; services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null }>(tenant: T): Promise<T> {
  if (PROJECTED.has(tenant)) return tenant;
  try {
    const [items, cats] = await Promise.all([
      loadKbItems(tenant.id),
      getSupabaseAdmin().from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenant.id),
    ]);
    if (!items || cats.error) return tenant;
    const row = kbCallerRow(tenant, items, (cats.data || []) as KbCategory[]);
    PROJECTED.add(row);
    return row;
  } catch {
    return tenant;
  }
}
