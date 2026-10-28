"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";
import { bustTenantCache } from "@/lib/tenantCache";
import { draftErrors, itemFromDraft, mirrorLegacy, slug, type KbCategory, type KbDraft, type KbItem } from "@/lib/kbCore";
import { pingKbCompile } from "@/lib/kb.server";

export type KbActionResult = { ok: true } | { ok: false; error: string };

const ITEM_COLS =
  "id, kind, name_en, name_sw, name_sw_state, name_sw_suggested, aliases, category_id, description_en, unit, price_mode, price_amount, price_min, price_max, in_stock, popular, delivery_fee_kes, status, sort, source, legacy_ref, row_version";

async function ownerTenant(): Promise<{ id: string } | { error: string }> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };
  return { id: tenant.id };
}

const asNum = (v: unknown) => (v == null ? null : Number(v));

async function loadItem(tenantId: string, id: string): Promise<KbItem | null> {
  const { data } = await getSupabaseAdmin().from("kb_items").select(ITEM_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { ...(r as unknown as KbItem), price_amount: asNum(r.price_amount), price_min: asNum(r.price_min), price_max: asNum(r.price_max), aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [] };
}

/** Write rows, keep today's catalogue columns in step, then ask Voice to compile (runs after the reply). */
async function writeItems(tenantId: string, items: KbItem[]): Promise<KbActionResult> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.rpc("kb_upsert_items", { p_tenant: tenantId, p_items: items });
  if (error) return { ok: false, error: "Couldn't save. Nothing was changed. Try again." };
  const conflicts = (data as { conflicts?: string[] } | null)?.conflicts || [];
  if (conflicts.length) return { ok: false, error: "Someone else changed this item. Reload the page and try again." };
  await mirror(tenantId);
  bustTenantCache(tenantId);
  void pingKbCompile(tenantId, { by: "desk" });
  revalidatePath("/settings/knowledge");
  return { ok: true };
}

/** Compat mirror (until the old columns are dropped): kb_items -> services_catalog / product_catalog. */
async function mirror(tenantId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const [items, cats, t] = await Promise.all([
    sb.from("kb_items").select(ITEM_COLS).eq("tenant_id", tenantId).order("sort").limit(20000),
    sb.from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenantId),
    sb.from("tenants").select("services_catalog, product_catalog").eq("id", tenantId).maybeSingle(),
  ]);
  if (items.error || cats.error || t.error || !t.data) return;
  const rows = ((items.data || []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as KbItem), price_amount: asNum(r.price_amount), price_min: asNum(r.price_min), price_max: asNum(r.price_max) }));
  const m = mirrorLegacy(rows, (cats.data || []) as KbCategory[], t.data as { services_catalog: unknown; product_catalog: unknown });
  const { error } = await sb.from("tenants").update(m).eq("id", tenantId);
  if (error) console.warn(`[kb] legacy mirror tenant=${tenantId} failed`);
}

async function categoryId(tenantId: string, name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const sb = getSupabaseAdmin();
  const id = slug(clean) || "group";
  const { data } = await sb.from("kb_categories").select("id").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!data) await sb.from("kb_categories").insert({ tenant_id: tenantId, id, name_en: clean.slice(0, 120), sort: 999 });
  return id;
}

export async function saveKbItemAction(draft: KbDraft): Promise<KbActionResult> {
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const errs = draftErrors(draft);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const prev = draft.id ? await loadItem(t.id, draft.id) : null;
  const item = itemFromDraft(draft, prev, await categoryId(t.id, draft.category));
  return writeItems(t.id, [item]);
}

export async function setKbFlagAction(id: string, flag: { popular?: boolean; in_stock?: boolean | null }): Promise<KbActionResult> {
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const prev = await loadItem(t.id, id);
  if (!prev) return { ok: false, error: "That item is gone. Reload the page." };
  return writeItems(t.id, [{ ...prev, ...("popular" in flag ? { popular: !!flag.popular } : {}), ...("in_stock" in flag ? { in_stock: flag.in_stock ?? null } : {}) }]);
}

export async function hideKbItemAction(id: string): Promise<KbActionResult> {
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const prev = await loadItem(t.id, id);
  if (!prev) return { ok: true };
  return writeItems(t.id, [{ ...prev, status: "hidden" }]);
}

/** Swahili names: the AI suggests, the owner decides. Only approved or edited names are ever spoken. */
export async function decideSwNameAction(id: string, decision: "approve" | "edit" | "reject", text?: string): Promise<KbActionResult> {
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const prev = await loadItem(t.id, id);
  if (!prev) return { ok: false, error: "That item is gone. Reload the page." };
  if (decision === "approve") {
    const sw = (prev.name_sw_suggested || "").trim();
    if (!sw) return { ok: false, error: "There is no suggestion to approve." };
    return writeItems(t.id, [{ ...prev, name_sw: sw, name_sw_state: "approved" }]);
  }
  if (decision === "edit") {
    const sw = String(text || "").trim().slice(0, 120);
    if (!sw) return { ok: false, error: "Type the Swahili name." };
    return writeItems(t.id, [{ ...prev, name_sw: sw, name_sw_state: "edited" }]);
  }
  return writeItems(t.id, [{ ...prev, name_sw: null, name_sw_state: "rejected" }]);
}

/** "Check again": compile now and re-run the readiness checks. */
export async function compileKbAction(): Promise<KbActionResult> {
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const r = await pingKbCompile(t.id, { by: "desk", force: true });
  revalidatePath("/settings/knowledge");
  return r.ok ? { ok: true } : { ok: false, error: "Couldn't reach your Business Assistant. Try again in a minute." };
}
