"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { upsertTenantFieldMeta } from "@/lib/deskProvenance";
import { recompileAfterCatalogImport } from "@/lib/catalogImportRecompile";
import {
  categoriesFor,
  cleanPayments,
  isIntent,
  isLostReason,
  isOutcome,
  paymentsSentence,
  priceLabel,
  sanitizePricing,
  validatePayments,
  type Payments,
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

/** Typed payments. The text line is rewritten from them so the Business Assistant says the same thing. */
export async function savePaymentsAction(input: Payments): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const ws = await workspace();
  if ("error" in ws) return { ok: false, error: ws.error ?? SAVE_FAILED };
  const payments: Payments = { ...cleanPayments(input), source: "owner", confirmed: true };
  const fields = validatePayments(payments);
  if (Object.keys(fields).length) return { ok: false, error: "Check the highlighted fields.", fields };
  const policies = ws.tenant.business_policies && typeof ws.tenant.business_policies === "object" ? ws.tenant.business_policies : {};
  const sentence = paymentsSentence(payments);
  const next = { ...policies, payments, ...(sentence ? { payment: sentence } : {}) };
  const { error } = await ws.client.from("tenants").update({ business_policies: next }).eq("id", ws.tenant.id);
  if (error) return { ok: false, error: SAVE_FAILED };
  await upsertTenantFieldMeta({ tenantId: ws.tenant.id, fieldPath: "payments.methods", source: "owner", actor: "desk", newValue: payments }).catch(() => null);
  // Rebuild the Business Assistant prompt now, so the next call quotes the new payment line.
  const compiled = await recompileAfterCatalogImport({ client: ws.client, tenant: { ...ws.tenant, business_policies: next } }).catch(() => ({ ok: false }));
  revalidatePath("/settings");
  revalidatePath("/home");
  return {
    ok: true,
    message: compiled.ok
      ? "Payments saved. Your Business Assistant uses them from the next call."
      : "Payments saved. Your Business Assistant picks them up after the next Settings save.",
  };
}

/** Owner answers "Is this right?" for one item's typed price (yes, or a corrected price). */
export async function confirmPriceAction(input: { kind: "product" | "service"; name: string; pricing: StructuredPrice }): Promise<StructuredResult> {
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
  const rows = Array.isArray(ws.tenant[column]) ? (ws.tenant[column] as Array<Record<string, unknown>>) : [];
  const name = input.name.trim().toLowerCase();
  let hit = false;
  const next = rows.map((row) => {
    if (hit || String(row?.name || "").trim().toLowerCase() !== name) return row;
    hit = true;
    const label = priceLabel(pricing);
    return { ...row, pricing: { ...pricing, parsed_from: label }, [textKey]: label, source: "owner" };
  });
  if (!hit) return { ok: false, error: "That item is no longer in your catalogue." };
  const { error } = await ws.client.from("tenants").update({ [column]: next }).eq("id", ws.tenant.id);
  if (error) return { ok: false, error: SAVE_FAILED };
  // Same as payments: the prompt quotes prices, so rebuild it with the confirmed one.
  await recompileAfterCatalogImport({
    client: ws.client,
    tenant: { ...ws.tenant, [column]: next },
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
