import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantRow } from "@/lib/supabase";

export type FreshCatalog = Pick<TenantRow, "product_catalog" | "services_catalog">;

/**
 * The catalogue columns as stored right now, read past the per-tenant cache. Use it before any
 * read-modify-write of a catalogue column so a write made in the last few seconds (a price
 * confirm, the voice server, an import) is not overwritten from a stale copy.
 */
export async function readCatalogFresh(client: SupabaseClient, tenantId: string): Promise<FreshCatalog | null> {
  const { data, error } = await client
    .from("tenants")
    .select("product_catalog, services_catalog")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data as FreshCatalog;
}
