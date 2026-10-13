/**
 * PostgREST reports an unknown column as e.g.
 *   Could not find the 'hours_schedule' column of 'tenants' in the schema cache
 *   column tenants.hours_schedule does not exist
 * Return that column name so callers can drop only it (not every optional field).
 */
export function missingColumnFromError(message: string | null | undefined): string | null {
  const text = String(message || "");
  const a = text.match(/Could not find the '([a-z0-9_]+)' column/i);
  if (a) return a[1];
  const b = text.match(/column\s+(?:"?[a-z0-9_]+"?\.)?"?([a-z0-9_]+)"?\s+(?:of relation "?[a-z0-9_]+"?\s+)?does not exist/i);
  if (b) return b[1];
  return null;
}

/**
 * Run an update, dropping only columns the database says are missing, one at a time.
 * Returns the columns that were dropped so callers can surface partial saves.
 */
export async function updateWithColumnPeel(
  patch: Record<string, unknown>,
  run: (patch: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>,
  required: string[] = []
): Promise<{ error: string | null; dropped: string[] }> {
  const current = { ...patch };
  const dropped: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const { error } = await run(current);
    if (!error) return { error: null, dropped };
    const col = missingColumnFromError(error.message);
    if (!col || !(col in current) || required.includes(col)) {
      return { error: error.message, dropped };
    }
    delete current[col];
    dropped.push(col);
  }
  return { error: "Too many missing columns.", dropped };
}
