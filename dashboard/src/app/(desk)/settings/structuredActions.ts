"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { bustTenantCache } from "@/lib/tenantCache";
import { requestSpokenCatalogueCompile } from "@/lib/spokenCatalogueOnSave";
import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { recompileAfterCatalogImport } from "@/lib/catalogImportRecompile";
import { readCatalogFresh } from "@/lib/catalogFresh";
import { planFactConfirm } from "@/lib/factConfirm";
import { ownerConfirmPlan, readSavedFactRow } from "@/lib/ownerAttestFields";
import {
  categoriesFor,
  isIntent,
  isLostReason,
  isOutcome,
} from "@/lib/structuredData";
import { reportFactHashRestampFailure } from "@/lib/factHashRestampReport";
import { PRICE_SAVE_FAILED, runPriceBatch, type CatalogColumns, type PriceConfirmInput } from "@/lib/priceBatch";
import type { TenantRow } from "@/lib/supabase";

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
  paths: string[],
  written: CatalogColumns
): Promise<void> {
  if (!paths.length) return;
  try {
    // One read of the row as saved, one confirm_tenant_fields batch for every .price and .name path.
    const saved = (await readSavedFactRow(client, tenantId)) ?? written;
    // before = after: nothing reads as changed, so only the explicit .price and .name paths are stamped.
    await ownerConfirmPlan(tenantId, planFactConfirm({ scope: "catalog", before: saved, after: saved, explicitPaths: paths }));
  } catch (err) {
    // Price save already committed; do not fail the owner action. Under
    // FACT_HASH_MODE=on a missed re-stamp drops the row from the grounded catalogue.
    for (const path of paths.filter((p) => p.endsWith(".price"))) {
      reportFactHashRestampFailure({ tenantId, itemPath: path, error: err });
    }
  }
}

/** Owner answers "Is this right?" for one item's typed price (yes, or a corrected price). */
export async function confirmPriceAction(input: PriceConfirmInput): Promise<StructuredResult> {
  return confirmPricesAction([input]);
}

/**
 * One or many confirmed prices: one fresh catalogue read, ONE tenants update,
 * ONE hash re-stamp and ONE prompt rebuild (runPriceBatch), however many items.
 */
export async function confirmPricesAction(inputs: PriceConfirmInput[]): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  if (!Array.isArray(inputs) || !inputs.length) return { ok: false, error: "Nothing to save." };
  if (inputs.length > 200) return { ok: false, error: "Too many prices at once. Save them in smaller groups." };
  const ws = await workspace();
  if ("error" in ws) return { ok: false, error: ws.error ?? PRICE_SAVE_FAILED };
  const tenantId = ws.tenant.id;
  const res = await runPriceBatch(
    {
      // Read the columns as stored now (not the cached tenant) and patch only the confirmed items.
      readFresh: () => readCatalogFresh(ws.client, tenantId),
      write: async (columns) => {
        const { error } = await ws.client.from("tenants").update(columns).eq("id", tenantId);
        bustTenantCache(tenantId);
        if (!error) requestSpokenCatalogueCompile(tenantId, columns);
        return { error };
      },
      // Failures are reported inside restampPriceHash (structured log); never block the save.
      restamp: (paths, columns) => restampPriceHash(ws.client, tenantId, paths, columns),
      // Same as payments: the prompt quotes prices, so rebuild it with the confirmed ones.
      recompile: (fresh, columns) =>
        recompileAfterCatalogImport({
          client: ws.client,
          tenant: { ...ws.tenant, ...fresh, ...columns } as TenantRow,
          ...(columns.product_catalog ? { productCatalog: columns.product_catalog } : {}),
        }).catch(() => null),
    },
    inputs
  );
  if (res.ok) revalidatePath("/settings");
  return res;
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
  return { ok: true, message: "Saved what you sell." };
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
