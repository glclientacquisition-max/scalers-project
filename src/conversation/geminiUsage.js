'use strict';

// Per-call Gemini token usage (input, cached, output, thinking).
// Read from usageMetadata on each response or stream. Summed per call in
// memory, logged once when the call closes, and written to public.call_usage
// when that table exists. Every path here is best effort: it never throws
// into the call and never waits on the database before the caller is served.
//
// CALL_USAGE_LOG=off      no tracking, no log line, no insert.
// CALL_USAGE_PERSIST=off  keep the log line, skip the insert.

const FIELDS = ['input', 'cached', 'output', 'thinking', 'toolUse'];

function flagOff(raw) {
  return /^(0|false|off|no)$/i.test(String(raw == null ? '' : raw).trim());
}

function usageLogEnabled(env = process.env) {
  return !flagOff(env.CALL_USAGE_LOG);
}

function usagePersistEnabled(env = process.env) {
  return usageLogEnabled(env) && !flagOff(env.CALL_USAGE_PERSIST);
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Gemini usageMetadata to plain counts, or null when the response had none.
 * input includes cached tokens (Gemini promptTokenCount). thinking is billed
 * as output.
 */
function usageFromMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const usage = {
    input: count(meta.promptTokenCount),
    cached: count(meta.cachedContentTokenCount),
    output: count(meta.candidatesTokenCount),
    thinking: count(meta.thoughtsTokenCount),
    toolUse: count(meta.toolUsePromptTokenCount),
  };
  if (!FIELDS.some((key) => usage[key] > 0)) return null;
  return usage;
}

function usageFromResponse(response) {
  return usageFromMetadata(response?.usageMetadata || response?.usage_metadata);
}

/**
 * Stream chunks repeat usageMetadata as running totals; the final chunk has
 * the full count. Keep the largest value seen for each field.
 */
function mergeStreamUsage(prev, chunk) {
  const next = usageFromResponse(chunk);
  if (!next) return prev || null;
  if (!prev) return next;
  const merged = {};
  for (const key of FIELDS) merged[key] = Math.max(prev[key] || 0, next[key] || 0);
  return merged;
}

function emptyTotals() {
  return {
    requests: 0,
    requestsWithoutUsage: 0,
    input: 0,
    cached: 0,
    output: 0,
    thinking: 0,
    toolUse: 0,
    models: {},
    kinds: {},
    tenantId: null,
  };
}

function addUsage(totals, usage, { model = '', kind = 'turn' } = {}) {
  const t = totals || emptyTotals();
  t.requests += 1;
  const modelKey = String(model || 'unknown');
  const kindKey = String(kind || 'turn');
  t.models[modelKey] = (t.models[modelKey] || 0) + 1;
  t.kinds[kindKey] = (t.kinds[kindKey] || 0) + 1;
  if (!usage) {
    t.requestsWithoutUsage += 1;
    return t;
  }
  for (const key of FIELDS) t[key] += count(usage[key]);
  return t;
}

/** Row for public.call_usage (and the log line). */
function summarizeCallUsage(totals, { callSid = '', tenantId = null } = {}) {
  const t = totals || emptyTotals();
  const input = count(t.input);
  const cached = Math.min(count(t.cached), input);
  return {
    call_sid: String(callSid || ''),
    tenant_id: tenantId || t.tenantId || null,
    requests: count(t.requests),
    requests_without_usage: count(t.requestsWithoutUsage),
    input_tokens: input,
    cached_tokens: cached,
    uncached_input_tokens: input - cached,
    output_tokens: count(t.output),
    thinking_tokens: count(t.thinking),
    tool_use_tokens: count(t.toolUse),
    cache_hit_ratio: input ? Number((cached / input).toFixed(4)) : 0,
    models: { ...t.models },
    kinds: { ...t.kinds },
  };
}

function formatUsageLogLine(row) {
  return (
    `[usage] call=${row.call_sid} requests=${row.requests}` +
    ` noUsage=${row.requests_without_usage} input=${row.input_tokens}` +
    ` cached=${row.cached_tokens} output=${row.output_tokens}` +
    ` thinking=${row.thinking_tokens} cacheHit=${Math.round(row.cache_hit_ratio * 100)}%`
  );
}

function isMissingTableError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (/call_usage/.test(msg) && /does not exist|schema cache/i.test(msg))
  );
}

/**
 * In-memory ledger keyed by call sid. note() is sync and cheap; flush() is
 * fire-and-forget and swallows every error.
 */
const MAX_OPEN_CALLS = 500;

function createCallUsageLedger({ env = process.env, log = console, getClient = null } = {}) {
  const byCall = new Map();
  let tableMissing = false;

  function note(callSid, usage, opts = {}) {
    try {
      if (!callSid || !usageLogEnabled(env)) return;
      const key = String(callSid);
      if (!byCall.has(key) && byCall.size >= MAX_OPEN_CALLS) {
        // A call that never closed cleanly. Drop the oldest; memory stays bounded.
        byCall.delete(byCall.keys().next().value);
      }
      byCall.set(key, addUsage(byCall.get(key), usage, opts));
    } catch {
      /* never block a call */
    }
  }

  function setTenant(callSid, tenantId) {
    try {
      if (!callSid || !tenantId || !usageLogEnabled(env)) return;
      const key = String(callSid);
      const t = byCall.get(key) || emptyTotals();
      t.tenantId = String(tenantId);
      byCall.set(key, t);
    } catch {
      /* ignore */
    }
  }

  function peek(callSid) {
    return byCall.get(String(callSid)) || null;
  }

  function take(callSid) {
    const key = String(callSid);
    const t = byCall.get(key) || null;
    byCall.delete(key);
    return t;
  }

  /** Move usage noted under a temporary label onto the real call sid. */
  function rename(fromSid, toSid) {
    try {
      if (!fromSid || !toSid || fromSid === toSid) return;
      const from = take(fromSid);
      if (!from) return;
      const into = byCall.get(String(toSid));
      if (!into) {
        byCall.set(String(toSid), from);
        return;
      }
      into.requests += from.requests;
      into.requestsWithoutUsage += from.requestsWithoutUsage;
      for (const k of FIELDS) into[k] += from[k];
      for (const [m, n] of Object.entries(from.models)) into.models[m] = (into.models[m] || 0) + n;
      for (const [m, n] of Object.entries(from.kinds)) into.kinds[m] = (into.kinds[m] || 0) + n;
      into.tenantId = into.tenantId || from.tenantId;
    } catch {
      /* ignore */
    }
  }

  async function flush(callSid, { tenantId = null } = {}) {
    try {
      const totals = take(callSid);
      if (!totals || !totals.requests || !usageLogEnabled(env)) return null;
      const row = summarizeCallUsage(totals, { callSid, tenantId });
      log.log(formatUsageLogLine(row));
      if (!usagePersistEnabled(env) || tableMissing) return row;
      const client = typeof getClient === 'function' ? getClient() : null;
      if (!client || typeof client.from !== 'function') return row;
      const { error } = await client.from('call_usage').insert(row);
      if (error) {
        if (isMissingTableError(error)) {
          tableMissing = true;
          log.warn('[usage] call_usage table missing; logging only until restart');
        } else {
          log.warn('[usage] call_usage insert failed:', error.message || error);
        }
      }
      return row;
    } catch (err) {
      try {
        log.warn('[usage] flush failed:', err?.message || err);
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  return { note, setTenant, peek, take, rename, flush, size: () => byCall.size };
}

module.exports = {
  usageLogEnabled,
  usagePersistEnabled,
  usageFromMetadata,
  usageFromResponse,
  mergeStreamUsage,
  emptyTotals,
  addUsage,
  summarizeCallUsage,
  formatUsageLogLine,
  isMissingTableError,
  createCallUsageLedger,
  MAX_OPEN_CALLS,
};
