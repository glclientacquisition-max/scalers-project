import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { KbItem, KbKind } from "@/lib/kbCore";

import { undoErrorMessage, type ImportSource } from "@/lib/importUndo";

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

export type UndoResult = { ok: true; restored: number; removed: number; restoredIds: string[]; already?: boolean } | { ok: false; error: string };

export async function undoImportRun(tenantId: string, runId: string): Promise<UndoResult> {
  const sb = getSupabaseAdmin();
  const { data: run } = await sb.from("kb_import_runs").select("before_rows").eq("tenant_id", tenantId).eq("id", runId).maybeSingle();
  const restoredIds = (((run as { before_rows?: RawRow[] } | null)?.before_rows || []) as RawRow[]).filter((r) => r.status !== "hidden").map((r) => r.id);
  const { data, error } = await sb.rpc("kb_undo_import", { p_tenant: tenantId, p_run: runId });
  if (error) return { ok: false, error: undoErrorMessage(error.code) };
  const r = (data || {}) as { restored?: number; removed?: number; already?: boolean };
  return { ok: true, restored: r.restored || 0, removed: r.removed || 0, restoredIds, ...(r.already ? { already: true } : {}) };
}
