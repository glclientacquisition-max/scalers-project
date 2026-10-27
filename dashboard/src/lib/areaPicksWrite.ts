/**
 * tenant_area_picks write without a gap: upsert the new rows, then prune the rows the owner removed.
 * No transaction from PostgREST and Desk adds no SQL/RPC, so the order is what keeps it safe:
 *   - upsert fails -> nothing changed, the old picks stay.
 *   - prune fails  -> new picks are in, a removed pick may linger; the save reports an error and a retry finishes it.
 * Never a moment with zero picks (the old delete-then-insert could leave a tenant with none).
 *
 * Pure apart from the client passed in. Relative imports only so node tests can load it.
 */

export type AreaPickRow = {
  tenant_id: string;
  node: string;
  serve: boolean;
  fee_kes: number | null;
  note: string | null;
  confirmed_at: string | null;
  tree_version: string;
  moved_from: string[] | null;
  updated_at: string;
  updated_by: string | null;
};

type Result = { error: { message: string } | null };
/** The slice of the Supabase query builder this needs (lets tests pass a fake). */
export type PicksClient = {
  from(table: "tenant_area_picks"): {
    upsert(rows: AreaPickRow[], opts: { onConflict: string }): PromiseLike<Result>;
    delete(): {
      eq(col: "tenant_id", v: string): PromiseLike<Result> & {
        not(col: "node", op: "in", list: string): PromiseLike<Result>;
      };
    };
  };
};

/** PostgREST in-list with every value quoted (node ids carry ":" and "-"). */
export function postgrestInList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

export async function writeAreaPickRows(
  client: PicksClient,
  tenantId: string,
  rows: AreaPickRow[],
): Promise<{ ok: true } | { ok: false; error: string; stage: "upsert" | "prune" }> {
  if (rows.length) {
    const up = await client.from("tenant_area_picks").upsert(rows, { onConflict: "tenant_id,node" });
    if (up.error) return { ok: false, error: up.error.message, stage: "upsert" };
    const pruned = await client
      .from("tenant_area_picks")
      .delete()
      .eq("tenant_id", tenantId)
      .not("node", "in", postgrestInList(rows.map((r) => r.node)));
    if (pruned.error) return { ok: false, error: pruned.error.message, stage: "prune" };
    return { ok: true };
  }
  // Owner cleared every pick: nothing to upsert, remove all.
  const del = await client.from("tenant_area_picks").delete().eq("tenant_id", tenantId);
  if (del.error) return { ok: false, error: del.error.message, stage: "prune" };
  return { ok: true };
}
