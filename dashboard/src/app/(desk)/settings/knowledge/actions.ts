"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";
import { PASTE_MAX_ROWS, sameKbContent, draftErrors, gateDraftStatus, itemFromDraft, itemsFromPaste, parsePasteList, slug, type KbDraft, type KbItem, type KbKind, type KbPasteRow } from "@/lib/kbCore";
import { KB_ITEM_COLS, afterKbWrite, kbRowToItem, loadKbItems, writeKbItems } from "@/lib/kbWrite.server";
import { pingKbCompile } from "@/lib/kb.server";
import { deskKbItemStates } from "@/lib/deskFeatureFlags";

/** restamped false: saved, but the call facts could not be re-checked yet (the Desk says so instead of "on calls"). */
export type KbActionResult = { ok: true; restamped?: boolean; unchanged?: boolean } | { ok: false; error: string };

async function ownerTenant(): Promise<{ id: string } | { error: string }> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };
  return { id: tenant.id };
}

async function loadItem(tenantId: string, id: string): Promise<KbItem | null> {
  const { data } = await getSupabaseAdmin().from("kb_items").select(KB_ITEM_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return data ? kbRowToItem(data as Record<string, unknown>) : null;
}

/** Write rows, keep today's catalogue columns in step (derived mirror), then ask Voice to compile (runs after the reply). */
async function writeItems(tenantId: string, items: KbItem[], opts: { replaceKind?: KbKind } = {}): Promise<KbActionResult> {
  const w = await writeKbItems(tenantId, items, opts);
  if (!w.ok) return { ok: false, error: w.error };
  // Owner-reviewed write: re-stamp the call facts for what was written (hidden rows leave the catalogue).
  const restampIds = items.filter((i) => i.status !== "hidden").map((i) => i.id);
  const { restamped } = await afterKbWrite(tenantId, "desk", { restampIds });
  revalidatePath("/settings/knowledge");
  return { ok: true, ...(restamped === false ? { restamped: false } : {}) };
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
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const errs = draftErrors(draft);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const prev = draft.id ? await loadItem(t.id, draft.id) : null;
  // Flag off: a client that still sends Paused / Not offered can't set it (the stored state is kept).
  const gated = gateDraftStatus(draft, prev, deskKbItemStates());
  const item = itemFromDraft(gated, prev, await categoryId(t.id, gated.category));
  // Nothing changed: no write, no row_version bump, no mirror or compile.
  if (prev && sameKbContent(item, prev)) return { ok: true, unchanged: true };
  return writeItems(t.id, [item]);
}

export async function setKbFlagAction(id: string, flag: { popular?: boolean; in_stock?: boolean | null }): Promise<KbActionResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const prev = await loadItem(t.id, id);
  if (!prev) return { ok: false, error: "That item is gone. Reload the page." };
  return writeItems(t.id, [{ ...prev, ...("popular" in flag ? { popular: !!flag.popular } : {}), ...("in_stock" in flag ? { in_stock: flag.in_stock ?? null } : {}) }]);
}

export async function hideKbItemAction(id: string): Promise<KbActionResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const prev = await loadItem(t.id, id);
  if (!prev) return { ok: true };
  return writeItems(t.id, [{ ...prev, status: "hidden" }]);
}

/** Swahili names: the AI suggests, the owner decides. Only approved or edited names are ever spoken. */
export async function decideSwNameAction(id: string, decision: "approve" | "edit" | "reject", text?: string): Promise<KbActionResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
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
    if (!sw) return { ok: false, error: "Type the Kiswahili name." };
    return writeItems(t.id, [{ ...prev, name_sw: sw, name_sw_state: "edited" }]);
  }
  return writeItems(t.id, [{ ...prev, name_sw: null, name_sw_state: "rejected" }]);
}

/** "Check again": compile now and re-run the readiness checks. */
export async function compileKbAction(): Promise<KbActionResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  const r = await pingKbCompile(t.id, { by: "desk", force: true });
  revalidatePath("/settings/knowledge");
  return r.ok ? { ok: true } : { ok: false, error: "Couldn't reach your Business Assistant. Try again in a minute." };
}

async function loadAll(tenantId: string): Promise<KbItem[]> {
  return (await loadKbItems(tenantId)) || [];
}

/** Paste a list, step 1: parse for the preview (nothing saved). Names already in the catalogue are matched. */
export async function previewKbPasteAction(text: string): Promise<{ ok: true; rows: KbPasteRow[] } | { ok: false; error: string }> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  if (String(text || "").length > 200_000) return { ok: false, error: "That list is too long. Paste up to 500 lines at a time." };
  const rows = parsePasteList(text, await loadAll(t.id));
  if (!rows.length) return { ok: false, error: "No items found. Put one item on each line." };
  return { ok: true, rows };
}

/**
 * Paste a list, step 2: one batch write of the previewed rows (re-parsed server side, so the browser can't change prices).
 * mode "append" (default): add new rows, update matched ones. mode "replace": the paste becomes the whole list for that
 * kind; the kind's rows not in the paste are soft-removed (hidden, restorable), all in one transaction.
 */
export async function importKbPasteAction(rows: KbPasteRow[], kind: KbKind, group: string, mode: "append" | "replace" = "append"): Promise<KbActionResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const t = await ownerTenant();
  if ("error" in t) return { ok: false, error: t.error };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "Nothing to add." };
  if (rows.length > PASTE_MAX_ROWS) return { ok: false, error: `Add up to ${PASTE_MAX_ROWS} at a time.` };
  const k: KbKind = kind === "product" ? "product" : "service";
  const existing = await loadAll(t.id);
  const clean = parsePasteList(rows.map((r) => String(r.raw || "")).join("\n"), existing);
  const items = itemsFromPaste(clean, k, existing, await categoryId(t.id, String(group || "")));
  if (!items.length) return { ok: false, error: "Nothing to add." };
  return writeItems(t.id, items, mode === "replace" ? { replaceKind: k } : {});
}
