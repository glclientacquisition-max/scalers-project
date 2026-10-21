// VOICE_QUERY_BATCHING (default off): fewer, parallel Supabase round trips on
// the call path. N+1 audit 21 Oct 2026 (/workspace/briefs/n-plus-one-audit-2026-10-21.md):
//   1. call start: tenant extras folded into the main select; visits,
//      provenance and the caller card run in parallel (greeting waits on it).
//   2. owner alerts reuse the call's loaded profile, else one light select.
//   3. the call id / tenant / caller number are kept per call sid, and
//      calls.summary merges in one SQL UPDATE (merge_call_summary RPC when
//      applied; the old read-then-write otherwise).
//   4. the greeting warm sweep loads greeting fields for every tenant in one
//      query and skips tenants whose greeting inputs did not change.
// Off: every path is the pre-batching code, unchanged.

const ON = /^(1|true|on|yes)$/i;

function queryBatchingEnabled(env = process.env) {
  return ON.test(String(env.VOICE_QUERY_BATCHING ?? '').trim());
}

/**
 * Per-sid memo of the call row fields that do not change during a call:
 * id, tenant_id, from_number (and call_sid). Bounded and time-limited.
 */
function createCallIdentityMemo({ max = 5000, ttlMs = 3 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  /** @type {Map<string, { value: object, at: number }>} */
  const rows = new Map();

  function remember(row) {
    const sid = String(row?.call_sid || row?.sautikit_call_sid || '').trim();
    if (!sid || !row?.id) return;
    if (rows.size >= max) {
      const oldest = rows.keys().next().value;
      if (oldest !== undefined) rows.delete(oldest);
    }
    rows.delete(sid);
    rows.set(sid, {
      value: {
        id: row.id,
        tenant_id: row.tenant_id ?? null,
        call_sid: sid,
        from_number: row.from_number ?? row.caller_number ?? null,
      },
      at: now(),
    });
  }

  function get(callSid) {
    const sid = String(callSid || '').trim();
    const hit = rows.get(sid);
    if (!hit) return null;
    if (now() - hit.at > ttlMs) {
      rows.delete(sid);
      return null;
    }
    return { ...hit.value };
  }

  function forget(callSid) {
    rows.delete(String(callSid || '').trim());
  }

  return { remember, get, forget, size: () => rows.size, clear: () => rows.clear() };
}

module.exports = { queryBatchingEnabled, createCallIdentityMemo };
