import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bustTenantCache } from "@/lib/tenantCache";
import { pingKbCompile } from "@/lib/kb.server";
import { mirrorLegacy, type KbCategory, type KbItem, type KbKind } from "@/lib/kbCore";
import { extractServicesNotes } from "@/lib/servicesCatalog";
import { planLegacyImport, planTextImport, servicesOfferedFromKb, type KbLegacyItem } from "@/lib/kbLegacy";
import { catalogRestampPaths } from "@/lib/kbRestamp";
import { planFactConfirm } from "@/lib/factConfirm";
import { ownerConfirmPlan, readSavedFactRow } from "@/lib/ownerAttestFields";
import { listTenantFieldMeta } from "@/lib/tenantFieldProvenance";

/**
 * v2 KB writes, Desk side. kb_items is the source of truth (Alvin, 28 Oct). Rules for every caller:
 *  - Owner edits (Catalogue editor, Paste a list) go through writeKbItems.
 *  - Writers that still start from catalogue rows (onboarding, /api/tenant, website/FAQ import) go through
 *    addKbItemsFromLegacy: ADD-ONLY. New items are inserted; an item that already exists (same id or same name)
 *    is never changed, so an owner's paused / not offered / can be held / not included stays as set, and nothing
 *    absent from the old columns is ever hidden.
 *  - mirrorKbToLegacy is the only writer of services_catalog / product_catalog / services_offered for a KB business:
 *    a read-only copy derived from kb_items for readers not yet on the KB (dropped in phase 8).
 * Callers authorize first (memberDenied / setup access); these helpers use the service role.
 */

export const KB_ITEM_COLS =
  "id, kind, name_en, name_sw, name_sw_state, name_sw_suggested, aliases, category_id, description_en, unit, price_mode, price_amount, price_min, price_max, in_stock, popular, delivery_fee_kes, needs_visit, holdable, excludes_en, status_note, status, sort, source, legacy_ref, row_version";

const asNum = (v: unknown) => (v == null ? null : Number(v));
export function kbRowToItem(r: Record<string, unknown>): KbItem {
  return { ...(r as unknown as KbItem), price_amount: asNum(r.price_amount), price_min: asNum(r.price_min), price_max: asNum(r.price_max), aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [] };
}

export async function loadKbItems(tenantId: string): Promise<KbItem[] | null> {
  const { data, error } = await getSupabaseAdmin().from("kb_items").select(KB_ITEM_COLS).eq("tenant_id", tenantId).order("sort").limit(20000);
  if (error) return null;
  return ((data || []) as Record<string, unknown>[]).map(kbRowToItem);
}

/** Active (offered) items: the completion check for setup. null when the KB tables are not there yet. */
export async function countActiveKbItems(tenantId: string): Promise<number | null> {
  const { count, error } = await getSupabaseAdmin().from("kb_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active");
  return error ? null : count ?? 0;
}

export type KbWriteResult = { ok: true; upserted: number; hidden: number } | { ok: false; error: string; conflict?: boolean };

/**
 * Owner write. Default: upsert (append). replaceKind: the given items become the whole list for that kind; the
 * kind's other rows are soft-removed (status hidden) in the same transaction (rpc kb_import_items, 2026-10-28.3).
 */
export async function writeKbItems(tenantId: string, items: KbItem[] | KbLegacyItem[], opts: { replaceKind?: KbKind } = {}): Promise<KbWriteResult> {
  const sb = getSupabaseAdmin();
  const clean = (items as Record<string, unknown>[]).map((it) => {
    const rest = { ...it };
    delete rest.category_name;
    return rest;
  });
  const { data, error } = opts.replaceKind
    ? await sb.rpc("kb_import_items", { p_tenant: tenantId, p_kind: opts.replaceKind, p_items: clean, p_replace: true })
    : await sb.rpc("kb_upsert_items", { p_tenant: tenantId, p_items: clean });
  if (error) {
    if (error.code === "40001") return { ok: false, conflict: true, error: "Someone else changed this list. Reload the page and try again." };
    console.warn(`[kb] write tenant=${tenantId} failed code=${error.code || "?"}`);
    return { ok: false, error: "Couldn't save. Nothing was changed. Try again." };
  }
  const res = (data || {}) as { upserted?: number; hidden?: number; conflicts?: string[] };
  if (res.conflicts?.length) return { ok: false, conflict: true, error: "Someone else changed this item. Reload the page and try again." };
  return { ok: true, upserted: res.upserted || 0, hidden: res.hidden || 0 };
}

/** Compat mirror: kb_items -> services_catalog / product_catalog + the derived services_offered (one tenants update). */
export async function mirrorKbToLegacy(tenantId: string, opts: { notes?: string } = {}): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const [items, cats, t] = await Promise.all([
    loadKbItems(tenantId),
    sb.from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenantId),
    sb.from("tenants").select("services_catalog, product_catalog, services_offered").eq("id", tenantId).maybeSingle(),
  ]);
  if (!items || cats.error || t.error || !t.data) return false;
  const categories = (cats.data || []) as KbCategory[];
  const row = t.data as { services_catalog: unknown; product_catalog: unknown; services_offered: string | null };
  const m = mirrorLegacy(items, categories, row);
  const { error } = await sb.from("tenants").update({ ...m, services_offered: servicesOfferedFromKb(items, categories, opts.notes !== undefined ? `Additional notes:\n${opts.notes}` : row.services_offered) }).eq("id", tenantId);
  if (error) console.warn(`[kb] legacy mirror tenant=${tenantId} failed`);
  return !error;
}

/**
 * Owner-reviewed KB write: re-stamp tenant_field_meta for the written items (and rows the owner had already confirmed)
 * as the mirror now reads them. Without this every Catalogue save left the `.name` hash stale. Never fails the save.
 * Returns false when the re-stamp could not run (the save still stands).
 */
export async function restampKbCatalogMeta(tenantId: string, ids: string[]): Promise<boolean> {
  try {
    const [saved, meta] = await Promise.all([readSavedFactRow(getSupabaseAdmin(), tenantId), listTenantFieldMeta(tenantId)]);
    if (!saved) return false;
    const ownerPaths = (meta || []).filter((m) => m.source === "owner" && String(m.field_path).startsWith("catalog.")).map((m) => String(m.field_path));
    const paths = catalogRestampPaths(saved, ids, ownerPaths);
    if (!paths.length) return true;
    // before = after: nothing reads as changed, so only these explicit paths are stamped (same as restampPriceHash).
    await ownerConfirmPlan(tenantId, planFactConfirm({ scope: "catalog", before: saved, after: saved, explicitPaths: paths }));
    return true;
  } catch (err) {
    console.warn(`[kb] catalog meta restamp tenant=${tenantId} failed`, err instanceof Error ? err.message : "");
    return false;
  }
}

/**
 * After any KB write: mirror, bust caches, ask Voice to compile (in the background). `restampIds`: owner-reviewed
 * writes only (Desk editor, Paste, Import confirm); onboarding and /api/tenant stay unstamped for the owner to confirm.
 */
export async function afterKbWrite(tenantId: string, by = "desk", opts: { notes?: string; restampIds?: string[] } = {}): Promise<{ restamped: boolean | null }> {
  const mirrored = await mirrorKbToLegacy(tenantId, opts);
  const restamped = opts.restampIds && mirrored ? await restampKbCatalogMeta(tenantId, opts.restampIds) : opts.restampIds ? false : null;
  bustTenantCache(tenantId);
  void pingKbCompile(tenantId, { by });
  return { restamped };
}

export type KbAddResult = { ok: true; added: number; kept: number } | { ok: false; skipped: "no_kb" | "error" };

/**
 * ADD-ONLY import of catalogue rows (onboarding, /api/tenant, website/FAQ import). Existing items (same id or name)
 * are left exactly as the owner set them; nothing is hidden. Returns skipped "no_kb" before the KB SQL is applied.
 */
export async function addKbItemsFromLegacy(
  tenantId: string,
  rows: { services_catalog?: unknown; product_catalog?: unknown },
  by = "desk",
  mirror: { notes?: string; contentEdits?: boolean; restamp?: boolean } = {},
): Promise<KbAddResult> {
  const existing = await loadKbItems(tenantId);
  if (!existing) return { ok: false, skipped: "no_kb" };
  const cats = ((await getSupabaseAdmin().from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenantId)).data || []) as KbCategory[];
  const plan = planLegacyImport(rows, existing, { contentEdits: mirror.contentEdits === true, categories: cats });
  if (plan.categories.length) {
    const { error: ce } = await getSupabaseAdmin().from("kb_categories").upsert(plan.categories.map((c) => ({ tenant_id: tenantId, ...c })), { onConflict: "tenant_id,id", ignoreDuplicates: true });
    if (ce) console.warn(`[kb] add categories tenant=${tenantId} failed`);
  }
  if (plan.edits.length) {
    const w = await writeKbItems(tenantId, plan.edits);
    if (!w.ok) return { ok: false, skipped: "error" };
  }
  if (plan.fresh.length) {
    const w = await writeKbItems(tenantId, plan.fresh as KbItem[]);
    if (!w.ok) return { ok: false, skipped: "error" };
  }
  // restamp: the owner reviewed these rows (Import confirm), so their call facts are re-stamped as written.
  const restampIds = mirror.restamp ? [...plan.edits, ...plan.fresh].map((i) => String((i as { id: string }).id)) : undefined;
  await afterKbWrite(tenantId, by, { ...(mirror.notes !== undefined ? { notes: mirror.notes } : {}), ...(restampIds ? { restampIds } : {}) });
  return { ok: true, added: plan.fresh.length, kept: plan.kept };
}

/**
 * Writers that start from catalogue rows (onboarding, website/FAQ import): add the new rows to kb_items, then the
 * mirror rewrites the old columns + services_offered from the KB. Before the KB SQL exists (no_kb) the derived text
 * (and legacyColumns) passed in are stored instead, so a not-yet-migrated database keeps working.
 */
export async function importCatalogueToKb(
  tenantId: string,
  rows: { services_catalog?: unknown; product_catalog?: unknown },
  opts: { legacyServicesOffered: string; by: string; legacyColumns?: Record<string, unknown>; notes?: string; contentEdits?: boolean; restamp?: boolean },
): Promise<KbAddResult> {
  const r = await addKbItemsFromLegacy(tenantId, rows, opts.by, { ...(opts.notes !== undefined ? { notes: opts.notes } : {}), contentEdits: opts.contentEdits === true, restamp: opts.restamp === true });
  if (!r.ok && r.skipped === "no_kb") {
    const { error } = await getSupabaseAdmin().from("tenants").update({ ...(opts.legacyColumns || {}), services_offered: opts.legacyServicesOffered }).eq("id", tenantId);
    if (error) console.warn(`[kb] pre-KB services text tenant=${tenantId} failed`);
    bustTenantCache(tenantId);
  }
  return r;
}

/**
 * /api/tenant: the old free-text services field. Its lines become NEW kb items (add-only; a name already in the
 * Catalogue is left as the owner set it); its "Additional notes" stay the notes of the derived text. Before the KB SQL
 * exists the text is stored as it was (pre-KB databases only).
 */
export async function addKbItemsFromText(tenantId: string, text: string, kind: KbKind, by = "api"): Promise<KbAddResult> {
  const existing = await loadKbItems(tenantId);
  if (!existing) {
    const { error } = await getSupabaseAdmin().from("tenants").update({ services_offered: text }).eq("id", tenantId);
    if (error) console.warn(`[kb] pre-KB services text tenant=${tenantId} failed`);
    bustTenantCache(tenantId);
    return { ok: false, skipped: "no_kb" };
  }
  const plan = planTextImport(text, existing, kind);
  if (plan.fresh.length) {
    const w = await writeKbItems(tenantId, plan.fresh as KbItem[]);
    if (!w.ok) return { ok: false, skipped: "error" };
  }
  const notes = extractServicesNotes(text);
  await afterKbWrite(tenantId, by, notes ? { notes } : {});
  return { ok: true, added: plan.fresh.length, kept: plan.kept };
}
