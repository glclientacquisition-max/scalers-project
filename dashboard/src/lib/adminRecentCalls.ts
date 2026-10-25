/**
 * Super Admin Today: which businesses took a call since `since`.
 * One grouped read per chunk of ids: tenants with an embedded, filtered count of calls.
 * PostgREST computes `calls(count)` in SQL, so a busy week can't hit the row cap.
 * No `@/` imports, so tests (and the staging check) load it directly.
 */

/** Ids per request. Keeps the `in.(...)` filter well under URL limits (~37 chars per uuid). */
export const RECENT_CALLS_CHUNK = 150;

type CountRow = { id: string; calls?: Array<{ count: number | null }> | null };

// The slice of the Supabase client this uses. Kept structural so tests can pass a fake.
type Query = {
  select(columns: string): {
    in(column: string, values: string[]): {
      gte(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
};
type Client = { from(table: string): unknown };

export function chunkIds(ids: string[], size: number = RECENT_CALLS_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Count per requested business; a business the read did not return counts as 0. */
export function countsFromRows(ids: string[], rows: CountRow[]): Map<string, number> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const row of rows) {
    if (!counts.has(row.id)) continue;
    counts.set(row.id, Number(row.calls?.[0]?.count) || 0);
  }
  return counts;
}

/** Calls since `since` per business id. Throws on a failed read. */
export async function recentCallCounts(client: Client, ids: string[], since: string): Promise<Map<string, number>> {
  const unique = [...new Set(ids)];
  const rows: CountRow[] = [];
  for (const chunk of chunkIds(unique)) {
    const { data, error } = await (client.from("tenants") as Query)
      .select("id, calls(count)")
      .in("id", chunk)
      .gte("calls.created_at", since);
    if (error) throw error;
    rows.push(...((data as CountRow[] | null) || []));
  }
  return countsFromRows(unique, rows);
}
