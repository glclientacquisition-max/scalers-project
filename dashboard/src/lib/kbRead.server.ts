import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { KbCategory } from "@/lib/kbCore";
import { kbCatalogueView, type KbCatalogueView } from "@/lib/kbRead";
import { loadKbItems } from "@/lib/kbWrite.server";

/**
 * The business's catalogue fields read from kb_items (contract helpers). null when the KB tables are absent
 * (prod before the batch): callers then keep the stored services_offered / catalogue columns.
 * Callers authorize first; this uses the service role.
 */
export async function loadKbCatalogueView(
  tenantId: string,
  stored: { services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null },
): Promise<KbCatalogueView | null> {
  try {
    const [items, cats] = await Promise.all([
      loadKbItems(tenantId),
      getSupabaseAdmin().from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenantId),
    ]);
    if (!items || cats.error) return null;
    return kbCatalogueView(items, (cats.data || []) as KbCategory[], stored);
  } catch {
    return null;
  }
}
