'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  usageFromResponse,
  mergeStreamUsage,
  addUsage,
  summarizeCallUsage,
  formatUsageLogLine,
  createCallUsageLedger,
  MAX_OPEN_CALLS,
} = require('../src/conversation/geminiUsage');

const quietLog = { log() {}, warn() {} };

function meta(input, cached, output, thinking) {
  return {
    usageMetadata: {
      promptTokenCount: input,
      cachedContentTokenCount: cached,
      candidatesTokenCount: output,
      thoughtsTokenCount: thinking,
      totalTokenCount: input + output + thinking,
    },
  };
}

describe('gemini usage', () => {
  it('reads usageMetadata, including a response with no cache field', () => {
    assert.deepEqual(usageFromResponse(meta(8000, 6000, 40, 12)), {
      input: 8000,
      cached: 6000,
      output: 40,
      thinking: 12,
      toolUse: 0,
    });
    assert.deepEqual(usageFromResponse({ usageMetadata: { promptTokenCount: 7500, candidatesTokenCount: 30 } }), {
      input: 7500,
      cached: 0,
      output: 30,
      thinking: 0,
      toolUse: 0,
    });
    assert.equal(usageFromResponse({}), null);
    assert.equal(usageFromResponse(null), null);
    assert.equal(usageFromResponse({ usageMetadata: { promptTokenCount: 'x' } }), null);
  });

  it('keeps the final running totals from a stream', () => {
    let u = null;
    u = mergeStreamUsage(u, { candidates: [] });
    u = mergeStreamUsage(u, meta(8000, 0, 5, 12));
    u = mergeStreamUsage(u, { candidates: [] });
    u = mergeStreamUsage(u, meta(8000, 6000, 41, 12));
    assert.deepEqual(u, { input: 8000, cached: 6000, output: 41, thinking: 12, toolUse: 0 });
  });

  it('sums every request of a call, and counts requests that had no usage', () => {
    let t = null;
    t = addUsage(t, usageFromResponse(meta(8000, 0, 40, 10)), { model: 'gemini-3.6-flash', kind: 'turn_stream' });
    t = addUsage(t, usageFromResponse(meta(8200, 6100, 35, 8)), { model: 'gemini-3.6-flash', kind: 'turn_stream' });
    t = addUsage(t, null, { model: 'gemini-3.5-flash-lite', kind: 'turn_stream_cut' });
    const row = summarizeCallUsage(t, { callSid: 'CA1', tenantId: 't-1' });
    assert.equal(row.call_sid, 'CA1');
    assert.equal(row.tenant_id, 't-1');
    assert.equal(row.requests, 3);
    assert.equal(row.requests_without_usage, 1);
    assert.equal(row.input_tokens, 16200);
    assert.equal(row.cached_tokens, 6100);
    assert.equal(row.uncached_input_tokens, 10100);
    assert.equal(row.output_tokens, 75);
    assert.equal(row.thinking_tokens, 18);
    assert.equal(row.cache_hit_ratio, Number((6100 / 16200).toFixed(4)));
    assert.deepEqual(row.models, { 'gemini-3.6-flash': 2, 'gemini-3.5-flash-lite': 1 });
    assert.deepEqual(row.kinds, { turn_stream: 2, turn_stream_cut: 1 });
    assert.match(formatUsageLogLine(row), /requests=3 .*input=16200 cached=6100 output=75 thinking=18 cacheHit=38%/);
  });

  it('cached never exceeds input', () => {
    const row = summarizeCallUsage(addUsage(null, { input: 10, cached: 50, output: 0, thinking: 0 }), { callSid: 'x' });
    assert.equal(row.cached_tokens, 10);
    assert.equal(row.uncached_input_tokens, 0);
  });

  it('ledger flush logs once, inserts the row and forgets the call', async () => {
    const inserted = [];
    const logs = [];
    const client = { from: (t) => ({ insert: async (row) => { inserted.push([t, row]); return { error: null }; } }) };
    const ledger = createCallUsageLedger({ env: {}, log: { log: (l) => logs.push(l), warn() {} }, getClient: () => client });
    ledger.note('media_1', usageFromResponse(meta(100, 0, 1, 0)), { model: 'm' });
    ledger.note('CA9', usageFromResponse(meta(200, 150, 2, 1)), { model: 'm' });
    ledger.rename('media_1', 'CA9');
    const row = await ledger.flush('CA9', { tenantId: 'tid' });
    assert.equal(row.requests, 2);
    assert.equal(row.input_tokens, 300);
    assert.equal(row.cached_tokens, 150);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0][0], 'call_usage');
    assert.equal(inserted[0][1].tenant_id, 'tid');
    assert.equal(logs.length, 1);
    assert.equal(ledger.size(), 0);
    assert.equal(await ledger.flush('CA9'), null);
  });

  it('never throws: missing table, a throwing client, kill switches', async () => {
    let calls = 0;
    const missing = { from: () => ({ insert: async () => { calls += 1; return { error: { code: 'PGRST205', message: 'Could not find the table public.call_usage in the schema cache' } }; } }) };
    const ledger = createCallUsageLedger({ env: {}, log: quietLog, getClient: () => missing });
    ledger.note('A', usageFromResponse(meta(10, 0, 1, 0)));
    ledger.note('B', usageFromResponse(meta(10, 0, 1, 0)));
    assert.ok(await ledger.flush('A'));
    assert.ok(await ledger.flush('B'));
    assert.equal(calls, 1, 'stops trying after the table is missing');

    const boom = createCallUsageLedger({ env: {}, log: quietLog, getClient: () => { throw new Error('no db'); } });
    boom.note('C', usageFromResponse(meta(10, 0, 1, 0)));
    assert.equal(await boom.flush('C'), null);

    const rejecting = createCallUsageLedger({ env: {}, log: quietLog, getClient: () => ({ from: () => ({ insert: () => Promise.reject(new Error('net')) }) }) });
    rejecting.note('D', usageFromResponse(meta(10, 0, 1, 0)));
    assert.equal(await rejecting.flush('D'), null);

    let inserts = 0;
    const counting = () => ({ from: () => ({ insert: async () => { inserts += 1; return { error: null }; } }) });
    const noPersist = createCallUsageLedger({ env: { CALL_USAGE_PERSIST: 'off' }, log: quietLog, getClient: counting });
    noPersist.note('E', usageFromResponse(meta(10, 0, 1, 0)));
    assert.ok(await noPersist.flush('E'));
    assert.equal(inserts, 0);

    const off = createCallUsageLedger({ env: { CALL_USAGE_LOG: 'off' }, log: quietLog, getClient: counting });
    off.note('F', usageFromResponse(meta(10, 0, 1, 0)));
    assert.equal(off.size(), 0);
    assert.equal(await off.flush('F'), null);

    assert.doesNotThrow(() => ledger.note(undefined, null));
    assert.doesNotThrow(() => ledger.note('G', { input: NaN }));
  });

  it('memory stays bounded when calls never close', () => {
    const ledger = createCallUsageLedger({ env: {}, log: quietLog });
    for (let i = 0; i < MAX_OPEN_CALLS + 20; i += 1) ledger.note(`S${i}`, null);
    assert.equal(ledger.size(), MAX_OPEN_CALLS);
    assert.equal(ledger.peek('S0'), null);
  });
});
