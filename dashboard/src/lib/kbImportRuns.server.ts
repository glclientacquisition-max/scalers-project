import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { KbItem, KbKind } from "@/lib/kbCore";

import {
  FACTS_CHANGED_MESSAGE,
  factsChangedSince,
  mergeFactLog,
  undoErrorMessage,
  type FactKey,
  type FactState,
  type ImportSource,
} from "@/lib/importUndo";
import { loadAreaPicks } from "@/lib/areaPicks.server";

type RawRow = Record<string, unknown> & { id: string; kind: string; status: string; row_version: number };

/** The rows an import can change: every id it writes, plus (replace) every visible row of that kind. Full rows, for undo. */
export async function rowsBeforeImport(tenantId: string, ids: string[], replaceKind?: KbKind): Promise<RawRow[] | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("kb_items").select("*").eq("tenant_id", tenantId);
  if (error) return null;
  const want = new Set(ids);
  return ((data || []) as RawRow[])
    .filter((r) => want.has(r.id) || (replaceKind && r.kind === replaceKind && r.status !== "hidden"))
    .map((r) => {
      const rest = { ...r };
      delete rest.search_tsv;
      return rest;
    });
}

/** Log a committed import. Returns its id, or null when the log could not be written (the import itself stands). */
export async function logImportRun(opts: {
  tenantId: string;
  userId: string | null;
  source: ImportSource;
  mode: "append" | "replace";
  kind: KbKind;
  items: KbItem[];
  before: RawRow[];
  counts: Record<string, number>;
}): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const beforeIds = new Set(opts.before.map((r) => r.id));
  const touched = [...new Set([...opts.items.map((i) => i.id), ...beforeIds])];
  const { data: after, error: e1 } = await sb.from("kb_items").select("id,row_version").eq("tenant_id", opts.tenantId).in("id", touched);
  if (e1) return null;
  const afterVersions = Object.fromEntries(((after || []) as { id: string; row_version: number }[]).map((r) => [r.id, r.row_version]));
  const { data, error } = await sb
    .from("kb_import_runs")
    .insert({
      tenant_id: opts.tenantId,
      user_id: opts.userId,
      source: opts.source,
      mode: opts.mode,
      kind: opts.kind,
      counts: opts.counts,
      new_ids: opts.items.map((i) => i.id).filter((id) => !beforeIds.has(id)),
      before_rows: opts.before,
      after_versions: afterVersions,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.warn(`[kb] import log tenant=${opts.tenantId} failed code=${error?.code || "?"}`);
    return null;
  }
  return (data as { id: string }).id;
}

export type UndoResult =
  | { ok: true; restored: number; removed: number; restoredIds: string[]; factKeys: FactKey[]; already?: boolean }
  | { ok: false; error: string };

/** The stored facts the given keys cover, read fresh (not the cached tenant), for the import log and the undo check. */
export async function readFactState(tenantId: string, keys: FactKey[]): Promise<FactState | null> {
  if (!keys.length) return {};
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("tenants")
    .select("hours_schedule,business_policies,business_locations,faqs")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const out: FactState = {};
  if (keys.includes("hours")) out.hours = row.hours_schedule ?? null;
  if (keys.includes("policies")) out.policies = row.business_policies ?? null;
  if (keys.includes("locations")) out.locations = row.business_locations ?? null;
  if (keys.includes("faqs")) out.faqs = row.faqs ?? null;
  if (keys.includes("areas")) {
    const a = await loadAreaPicks(tenantId);
    if (!a.ok) return null;
    out.areas = a.row ? a.row.picks : null;
  }
  return out;
}

/** An import with only found facts (no items) still gets a log row, so its undo bar works. */
export async function openFactsRun(tenantId: string, userId: string | null, source: ImportSource): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("kb_import_runs")
    .insert({ tenant_id: tenantId, user_id: userId, source, mode: "append", kind: "service", counts: { rows: 0, facts: 0 } })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

type FactLogRow = { fact_before?: FactState; fact_after?: FactState; counts?: Record<string, number>; undone_at?: string | null };

async function factLog(tenantId: string, runId: string): Promise<FactLogRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("kb_import_runs")
    .select("fact_before,fact_after,counts,undone_at")
    .eq("tenant_id", tenantId)
    .eq("id", runId)
    .maybeSingle();
  return error || !data ? null : (data as FactLogRow);
}

/**
 * Before the found facts save (each card saves in its own request, so each reads the tenant fresh): record what the
 * keys they touch hold now. First write wins, so a second batch in the same import keeps the true before.
 */
export async function beginImportFacts(tenantId: string, runId: string, keys: FactKey[]): Promise<boolean> {
  const run = await factLog(tenantId, runId);
  if (!run || run.undone_at) return false;
  const now = await readFactState(tenantId, keys.filter((k) => !(run.fact_before && k in run.fact_before)));
  if (!now) return false;
  const { error } = await getSupabaseAdmin()
    .from("kb_import_runs")
    .update({ fact_before: { ...now, ...(run.fact_before || {}) } })
    .eq("tenant_id", tenantId)
    .eq("id", runId);
  return !error;
}

/** After the found facts saved: record what those keys hold now, which undo checks before it restores. */
export async function endImportFacts(tenantId: string, runId: string, keys: FactKey[], saved: number): Promise<boolean> {
  const run = await factLog(tenantId, runId);
  if (!run || run.undone_at) return false;
  const after = await readFactState(tenantId, keys);
  if (!after) return false;
  const pending = run.fact_before || {};
  // Keys the import did not end up changing are dropped from the log, so editing them later never blocks undo.
  const merged = mergeFactLog({ before: {}, after: run.fact_after }, pending, after);
  const before: FactState = {};
  for (const k of Object.keys(pending) as FactKey[]) if (k in merged.after || !keys.includes(k)) before[k] = pending[k];
  const { error } = await getSupabaseAdmin()
    .from("kb_import_runs")
    .update({ fact_before: before, fact_after: merged.after, counts: { ...(run.counts || {}), facts: (run.counts?.facts || 0) + saved } })
    .eq("tenant_id", tenantId)
    .eq("id", runId);
  if (error) console.warn(`[kb] import facts log tenant=${tenantId} failed code=${error.code || "?"}`);
  return !error;
}

/** One fact's value from before an import that was undone (read from the log, never from the browser). */
export async function factBeforeUndo(tenantId: string, runId: string, key: FactKey): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const run = await factLog(tenantId, runId);
  if (!run?.undone_at || !run.fact_before || !(key in run.fact_before)) return { ok: false };
  // Only right after the undo: this is the second half of it, not a way to rewind later.
  if (Date.now() - Date.parse(run.undone_at) > 5 * 60_000) return { ok: false };
  return { ok: true, value: run.fact_before[key] ?? null };
}

/**
 * Undo, items and facts together: refused before anything changes when a fact saved by this import was edited since
 * (the items RPC refuses the same way for items). The facts' before-values come back for the caller to restore
 * through their own settings saves, so calls recompile exactly as after an owner edit.
 */
export async function undoImportRun(tenantId: string, runId: string): Promise<UndoResult> {
  const sb = getSupabaseAdmin();
  const { data: run } = await sb
    .from("kb_import_runs")
    .select("before_rows,fact_before,fact_after,undone_at")
    .eq("tenant_id", tenantId)
    .eq("id", runId)
    .maybeSingle();
  const row = run as { before_rows?: RawRow[]; fact_before?: FactState; fact_after?: FactState; undone_at?: string | null } | null;
  const restoredIds = ((row?.before_rows || []) as RawRow[]).filter((r) => r.status !== "hidden").map((r) => r.id);
  const factsAfter = (row?.fact_after || {}) as FactState;
  const keys = Object.keys(factsAfter) as FactKey[];
  if (row && !row.undone_at && keys.length) {
    const current = await readFactState(tenantId, keys);
    if (!current) return { ok: false, error: undoErrorMessage(undefined) };
    if (factsChangedSince(factsAfter, current).length) return { ok: false, error: FACTS_CHANGED_MESSAGE };
  }
  const { data, error } = await sb.rpc("kb_undo_import", { p_tenant: tenantId, p_run: runId });
  if (error) return { ok: false, error: undoErrorMessage(error.code) };
  const r = (data || {}) as { restored?: number; removed?: number; already?: boolean };
  if (r.already) return { ok: true, restored: 0, removed: 0, restoredIds: [], factKeys: [], already: true };
  return { ok: true, restored: r.restored || 0, removed: r.removed || 0, restoredIds, factKeys: keys };
}
