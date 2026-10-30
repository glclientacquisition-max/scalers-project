import "server-only";
import type { TenantRow } from "@/lib/supabase";
import { extractKnowledgeFromText } from "@/lib/ingest/extract";
import { buildFactCards, mightHaveFacts, type FactCard } from "@/lib/importFactDiff";
import { listTenantFieldMeta } from "@/lib/tenantFieldProvenance";
import { loadAreaPicks } from "@/lib/areaPicks.server";

/**
 * Add many: hours, policies, payment, areas and FAQs found in a paste, file, photo or website, as one review card
 * per fact (lib/importFactDiff.ts). Reads only (the extract, tenant_field_meta and the area picks); nothing is saved.
 * A text with no sign of a fact costs no model call. Any failure is "no cards", so the item list still works.
 */
export async function findFactCards(tenant: TenantRow, text: string, sourceLabel: string): Promise<FactCard[]> {
  const body = String(text || "").trim().slice(0, 20_000);
  if (body.length < 12 || !mightHaveFacts(body)) return [];
  try {
    const [{ draft }, meta, areas] = await Promise.all([
      extractKnowledgeFromText({ sourceText: body, sourceLabel, businessName: tenant.business_name }),
      listTenantFieldMeta(tenant.id),
      loadAreaPicks(tenant.id),
    ]);
    const ownerPaths = new Set((meta || []).filter((m) => m.source === "owner").map((m) => m.field_path));
    const row = areas.ok ? areas.row : null;
    return buildFactCards({
      tenant,
      draft,
      ownerPaths,
      areas: row ? { picks: row.picks, confirmed: !!row.confirmed_at } : null,
    });
  } catch (err) {
    console.warn("[add-many] facts skipped:", err instanceof Error ? err.message : "");
    return [];
  }
}
