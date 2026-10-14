"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { bustTenantCache } from "@/lib/tenantCache";
import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { recompileAfterCatalogImport } from "@/lib/catalogImportRecompile";
import { readCatalogFresh } from "@/lib/catalogFresh";
import { catalogPricePath, findCatalogItem, patchCatalogItem } from "@/lib/catalogPricing";
import { planFactConfirm } from "@/lib/factConfirm";
import { ownerConfirmPlan, readSavedFactRow } from "@/lib/ownerAttestFields";
import {
  categoriesFor,
  isIntent,
  isLostReason,
  isOutcome,
  priceLabel,
  sanitizePricing,
  type StructuredPrice,
} from "@/lib/structuredData";

export type StructuredResult = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

const SAVE_FAILED = "Couldn't save. Nothing was changed. Try again.";

async function workspace() {
  const tenant = await getCurrentTenant();
  const workspace = await createWorkspaceDataClient();
  if (!tenant || !workspace) return { error: "Not signed in." } as const;
  return { tenant, client: workspace.client } as const;
}

async function restampPriceHash(
  client: SupabaseClient,
  tenantId: string,
  kind: "product" | "service",
  rows: Array<Record<string, unknown>>,
  target: { id?: string | null; name: string }
): Promise<void> {
  const path = catalogPricePath(kind, rows, findCatalogItem(rows, target));
  if (!path) return;
  // The save rewrites price_range/price to priceLabel(), which is part of the
  // row's .name value, so re-stamp .name too or a "yes, unchanged" goes stale.
  const namePath = path.replace(/\.price$/, ".name");
  const column = kind === "product" ? "product_catalog" : "services_catalog";
  const saved = (await readSavedFactRow(client, tenantId)) ?? { [column]: rows };
  // before = after: nothing reads as changed, so only the explicit .price and .name paths are stamped.
  await ownerConfirmPlan(tenantId, planFactConfirm({ scope: "catalog", before: saved, after: saved, explicitPaths: [path, namePath] }));
}

/** Owner answers "Is this right?" for one item's typed price (yes, or a corrected price). */
export async function confirmPriceAction(input: { kind: "product" | "service"; id?: string | null; name: string; pricing: StructuredPrice }): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const ws = await workspace();
  if ("error" in ws) return { ok: false, error: ws.error ?? SAVE_FAILED };
  const pricing = sanitizePricing({ ...input.pricing, source: "owner", confirmed: true });
  if (!pricing) return { ok: false, error: "Pick how this is priced." };
  if (pricing.mode !== "ask" && pricing.amount_ksh == null) return { ok: false, error: "Add the price in KSh.", fields: { amount: "Add the price in KSh." } };
  if (pricing.mode === "range" && (pricing.max_ksh == null || pricing.max_ksh < (pricing.amount_ksh ?? 0)))
    return { ok: false, error: "The top of the range must be higher.", fields: { max: "The top of the range must be higher." } };
  if (pricing.mode === "from" || pricing.mode === "range") pricing.min_ksh = pricing.amount_ksh;
  if (pricing.mode !== "range") pricing.max_ksh = null;
  if (pricing.mode === "ask") Object.assign(pricing, { amount_ksh: null, min_ksh: null, max_ksh: null });

  const column = input.kind === "product" ? "product_catalog" : "services_catalog";
  const textKey = input.kind === "product" ? "price" : "price_range";
  // Read the column as stored now (not the cached tenant) and patch only this item, found by id.
  const fresh = await readCatalogFresh(ws.client, ws.tenant.id);
  if (!fresh) return { ok: false, error: SAVE_FAILED };
  const rows = Array.isArray(fresh[column]) ? (fresh[column] as Array<Record<string, unknown>>) : [];
  const label = priceLabel(pricing);
  const next = patchCatalogItem(rows, { id: input.id, name: input.name }, (row) => ({
    ...row,
    pricing: { ...pricing, parsed_from: label },
    [textKey]: label,
    source: "owner",
  }));
  if (!next) return { ok: false, error: "That item is no longer in your catalogue." };
  const { error } = await ws.client.from("tenants").update({ [column]: next }).eq("id", ws.tenant.id);
  bustTenantCache(ws.tenant.id);
  if (error) return { ok: false, error: SAVE_FAILED };
  // The owner just confirmed this price: re-stamp its .price hash against the
  // row as saved, so the rewrite above does not leave a stale value_hash.
  await restampPriceHash(ws.client, ws.tenant.id, input.kind, next, { id: input.id, name: input.name }).catch((err) =>
    console.warn("[confirmPriceAction] price hash", err instanceof Error ? err.message : err)
  );
  // Same as payments: the prompt quotes prices, so rebuild it with the confirmed one.
  await recompileAfterCatalogImport({
    client: ws.client,
    tenant: { ...ws.tenant, ...fresh, [column]: next },
    ...(column === "product_catalog" ? { productCatalog: next } : {}),
  }).catch(() => null);
  revalidatePath("/settings");
  return { ok: true, message: "Price saved." };
}

export async function saveBusinessCategoryAction(category: string): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const ws = await workspace();
  if ("error" in ws) return { ok: false, error: ws.error ?? SAVE_FAILED };
  const type = (ws.tenant as { business_type?: string | null }).business_type || ws.tenant.vertical || "general";
  if (!categoriesFor(type === "retail" || type === "home_services" ? type : "general").some((c) => c.id === category))
    return { ok: false, error: "Pick from the list." };
  const { error } = await ws.client.from("tenants").update({ business_category: category }).eq("id", ws.tenant.id);
  bustTenantCache(ws.tenant.id);
  if (error) return { ok: false, error: SAVE_FAILED };
  revalidatePath("/settings");
  return { ok: true, message: "Business type saved." };
}

/** Owner correction of a call's intent/outcome. Stored as source=owner: trusted over the model. */
export async function correctCallFactsAction(input: { callId: string; intent: string; outcome: string; lostReason: string | null }): Promise<StructuredResult> {
  const denied = await memberDenied("inbox.act");
  if (denied) return { ok: false, error: denied.error };
  const ws = await workspace();
  if ("error" in ws) return { ok: false, error: ws.error ?? SAVE_FAILED };
  if (!isIntent(input.intent) || !isOutcome(input.outcome)) return { ok: false, error: "Pick from the list." };
  const lost = input.outcome === "lost" ? (isLostReason(input.lostReason) ? input.lostReason : "other") : null;
  const { error } = await ws.client.rpc("correct_call_facts", {
    p_call: input.callId,
    p_intent: input.intent,
    p_outcome: input.outcome,
    p_lost_reason: lost,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "Your role can't do this. Ask the owner or an admin." : SAVE_FAILED };
  revalidatePath(`/calls/${input.callId}`);
  return { ok: true, message: "Thanks. Saved as your answer." };
}
