// Column-tolerant select for tenant_field_meta.
//
// Confirm v2 adds value_hash (Desk SQL tenant_field_confirm_v2.sql). A database
// without that column must still load provenance, so the select steps down:
//   1. P0 + freshness + value_hash
//   2. P0 + freshness            (rows carry no value_hash key -> P0 rules)
//   3. P0 only
// A missing column is not a missing table: it steps down instead of failing.

const COLUMN_SETS = Object.freeze([
  'field_path, source, confirmed_by, confirmed_at, last_verified_at, stale_after_days, value_hash',
  'field_path, source, confirmed_by, confirmed_at, last_verified_at, stale_after_days',
  'field_path, source, confirmed_by, confirmed_at',
]);

function errorText(error) {
  return `${error?.code || ''} ${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
}

/** Postgres 42703 / PostgREST "column ... does not exist" for one of our optional columns. */
function isMissingColumnError(error) {
  if (!error) return false;
  const text = errorText(error);
  if (!/value_hash|last_verified_at|stale_after_days/i.test(text)) return false;
  return /42703|PGRST204|does not exist|could not find|schema cache/i.test(text);
}

/**
 * @param {(columns: string) => Promise<{ data: unknown, error: any }>} runSelect
 * @returns {Promise<{ rows: object[] | null, columns: string | null, error: any }>}
 *   rows null with error set: the caller decides (missing table vs throw).
 */
async function selectTenantFieldMeta(runSelect) {
  let lastError = null;
  for (const columns of COLUMN_SETS) {
    const { data, error } = await runSelect(columns);
    if (!error) return { rows: Array.isArray(data) ? data : [], columns, error: null };
    lastError = error;
    if (isMissingColumnError(error)) continue;
    // Any other error (missing table, network) goes back to the caller as is.
    return { rows: null, columns: null, error };
  }
  return { rows: null, columns: null, error: lastError };
}

module.exports = {
  TENANT_FIELD_META_COLUMN_SETS: COLUMN_SETS,
  isMissingColumnError,
  selectTenantFieldMeta,
};
