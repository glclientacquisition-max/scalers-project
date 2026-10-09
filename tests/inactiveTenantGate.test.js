'use strict';

// An archived or suspended business never takes the call: a short
// line-unavailable message and hang up, before Stream and the call row.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  LINE_UNAVAILABLE_EN,
  LINE_UNAVAILABLE_SW,
  sameNumber,
  tenantLineState,
  lineUnavailableXml,
  lineUnavailableResponse,
  usableClipUrl,
  allowedPlayHosts,
  resetClipProbeCache,
} = require('../src/sautikit/inactiveTenantGate');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const STAGING_DID = '+254709221537';

// Stub the Supabase client before db.js loads (no network, no env).
let tenantRows = [];
let failWith = null;
let archivedColumnMissing = false;
function fakeSupabase() {
  return {
    from(table) {
      assert.equal(table, 'tenants');
      return {
        select(cols) {
          if (failWith) return Promise.resolve({ data: null, error: { message: failWith } });
          if (archivedColumnMissing && /archived_at/.test(cols)) {
            return Promise.resolve({ data: null, error: { message: 'column tenants.archived_at does not exist' } });
          }
          const keep = cols.split(',').map((c) => c.trim());
          const data = tenantRows.map((row) => Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]])));
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: fakeSupabase() } };
  delete process.env.TENANT_ID;
  db = require('../src/db');
});

describe('tenantLineState', () => {
  it('a live owner keeps the line open; archived or inactive owners close it', () => {
    assert.deepEqual(tenantLineState([{ id: 'a', is_active: true }]), { closed: false, reason: 'live', tenantId: 'a' });
    assert.deepEqual(tenantLineState([{ id: 'a', is_active: false }]), { closed: true, reason: 'inactive', tenantId: 'a' });
    assert.deepEqual(tenantLineState([{ id: 'a', is_active: true, archived_at: '2026-10-09T10:00:00Z' }]), {
      closed: true,
      reason: 'archived',
      tenantId: 'a',
    });
    assert.deepEqual(tenantLineState([{ id: 'a', is_active: false, archived: true }]).reason, 'archived');
    // The number moved to a live business: open, routed to the live one.
    assert.deepEqual(tenantLineState([{ id: 'old', is_active: false, archived_at: 'x' }, { id: 'new', is_active: true }]), {
      closed: false,
      reason: 'live',
      tenantId: 'new',
    });
    // is_active missing is not a suspension (older rows).
    assert.equal(tenantLineState([{ id: 'a' }]).closed, false);
    assert.deepEqual(tenantLineState([]), { closed: false, reason: 'no_tenant', tenantId: null });
  });

  it('numbers match across +254 / 254 / 0 forms only on the full subscriber number', () => {
    assert.equal(sameNumber('+254709221537', '254709221537'), true);
    assert.equal(sameNumber('+254709221537', '0709221537'), true);
    assert.equal(sameNumber('+254709221537', '+254709221536'), false);
    assert.equal(sameNumber('', '+254709221537'), false);
    assert.equal(sameNumber('pending:abc', '+254709221537'), false);
  });
});

describe('lineUnavailableXml', () => {
  it('says the short en and sw line, then hangs up; never Stream', () => {
    const xml = lineUnavailableXml({ env: {} });
    assert.equal(
      xml,
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Say language="en-US">${LINE_UNAVAILABLE_EN}</Say><Say language="sw-KE">${LINE_UNAVAILABLE_SW}</Say><Hangup/></Response>`
    );
    assert.doesNotMatch(xml, /Stream|Connect/);
    assert.doesNotMatch(LINE_UNAVAILABLE_EN + LINE_UNAVAILABLE_SW, /downtime|outage|call back/i, 'not an outage message');
  });

  it('plays allow-listed clips when configured; ignores non-https values', () => {
    const xml = lineUnavailableXml({
      env: { VOICE_LINE_UNAVAILABLE_CLIP_URL_EN: 'https://cdn.example.com/a/en.wav', VOICE_LINE_UNAVAILABLE_CLIP_URL_SW: 'javascript:alert(1)' },
    });
    assert.match(xml, /<Play>https:\/\/cdn\.example\.com\/a\/en\.wav<\/Play><Say language="sw-KE">/);
    assert.match(xml, /<Hangup\/><\/Response>$/);
  });
});

describe('clip fallback: <Say> unless the clip is allowed and fetchable', () => {
  const EN = 'https://storage.sautikit.com/ws/line-en.wav?X-Amz-Signature=secret';
  const SW = 'https://storage.sautikit.com/ws/line-sw.wav?X-Amz-Signature=secret';
  const SAY_EN = `<Say language="en-US">${LINE_UNAVAILABLE_EN}</Say>`;
  const SAY_SW = `<Say language="sw-KE">${LINE_UNAVAILABLE_SW}</Say>`;
  const audio = (status = 206, type = 'audio/wav') => ({ status, headers: { get: () => type }, body: null });
  function fakeFetch(handler) {
    const calls = [];
    const fn = async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    };
    fn.calls = calls;
    return fn;
  }
  const quiet = () => {};

  it('unset vars: <Say> both, no network', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio());
    const xml = await lineUnavailableResponse({ env: {}, fetchImpl: f, log: quiet });
    assert.ok(xml.includes(SAY_EN + SAY_SW + '<Hangup/>'));
    assert.equal(f.calls.length, 0);
  });

  it('fetchable clips on an allowed host: <Play> both; probe is a ranged GET with a timeout signal', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio());
    const env = { VOICE_LINE_UNAVAILABLE_CLIP_URL_EN: EN, VOICE_LINE_UNAVAILABLE_CLIP_URL_SW: SW };
    const xml = await lineUnavailableResponse({ env, fetchImpl: f, log: quiet });
    assert.match(xml, /<Response><Play>https:\/\/storage\.sautikit\.com\/ws\/line-en\.wav\?X-Amz-Signature=secret<\/Play><Play>https:\/\/storage\.sautikit\.com\/ws\/line-sw\.wav/);
    assert.match(xml, /<Hangup\/><\/Response>$/);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].init.method, 'GET');
    assert.equal(f.calls[0].init.headers.Range, 'bytes=0-0');
    assert.ok(f.calls[0].init.signal);
  });

  it('host not allowed: <Say> without probing; VOICE_PLAY_ALLOWED_HOSTS opts a host in', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio(200, 'audio/mpeg'));
    const url = 'https://www.scalers.co.ke/audio/downtime-en.v1.wav';
    const logs = [];
    assert.equal(await usableClipUrl(url, { env: {}, fetchImpl: f, log: (m) => logs.push(m) }), '');
    assert.equal(f.calls.length, 0);
    assert.match(logs[0], /www\.scalers\.co\.ke not in VOICE_PLAY_ALLOWED_HOSTS/);
    assert.deepEqual(allowedPlayHosts({}), ['storage.sautikit.com']);
    const env = { VOICE_PLAY_ALLOWED_HOSTS: 'storage.sautikit.com, WWW.Scalers.co.ke' };
    assert.equal(await usableClipUrl(url, { env, fetchImpl: f, log: quiet }), url);
  });

  it('404, expired link (403), HTML page, network error or timeout: that language falls back to <Say>', async () => {
    const cases = [
      [() => audio(404, 'text/plain'), 'status_404'],
      [() => audio(403, 'application/xml'), 'status_403'],
      [() => audio(200, 'text/html; charset=utf-8'), 'not_audio'],
      [() => { throw new Error('ECONNRESET'); }, 'fetch_error'],
      [(u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), 'timeout'],
    ];
    for (const [handler, why] of cases) {
      resetClipProbeCache();
      const logs = [];
      const env = { VOICE_LINE_UNAVAILABLE_CLIP_URL_EN: EN, VOICE_LINE_UNAVAILABLE_CLIP_URL_SW: SW };
      const f = fakeFetch((u, init) => (u === EN ? handler(u, init) : audio()));
      const xml = await lineUnavailableResponse({ env, fetchImpl: f, timeoutMs: 20, log: (m) => logs.push(m) });
      assert.ok(xml.includes(SAY_EN + '<Play>'), why);
      assert.match(xml, /line-sw\.wav[^<]*<\/Play><Hangup\/>/, why);
      assert.ok(logs.some((m) => m.includes(`(${why})`)), `${why}: ${logs}`);
      assert.ok(logs.every((m) => !m.includes('Signature') && !m.includes('/ws/')), 'logs show the host only');
    }
  });

  it('caches the probe per URL: ok for 10 min, failure for 1 min', async () => {
    resetClipProbeCache();
    let t = 1_000_000;
    const now = () => t;
    let healthy = false;
    const f = fakeFetch(() => (healthy ? audio() : audio(503, 'text/plain')));
    const opts = { env: {}, fetchImpl: f, now, log: quiet };
    assert.equal(await usableClipUrl(EN, opts), '');
    healthy = true;
    t += 30_000;
    assert.equal(await usableClipUrl(EN, opts), '', 'failure still cached');
    assert.equal(f.calls.length, 1);
    t += 31_000;
    assert.equal(await usableClipUrl(EN, opts), EN, 'retried after a minute');
    healthy = false;
    t += 9 * 60_000;
    assert.equal(await usableClipUrl(EN, opts), EN, 'ok cached for ten minutes');
    assert.equal(f.calls.length, 2);
    t += 61_000;
    assert.equal(await usableClipUrl(EN, opts), '');
    assert.equal(f.calls.length, 3);
  });

  it('no fetch available: <Say>, never throws', async () => {
    resetClipProbeCache();
    const env = { VOICE_LINE_UNAVAILABLE_CLIP_URL_EN: EN };
    const xml = await lineUnavailableResponse({ env, fetchImpl: 'nope', log: quiet });
    assert.ok(xml.includes(SAY_EN + SAY_SW));
  });
});

describe('db.inboundTenantLine', () => {
  it('closed for an archived or suspended owner of the dialled number', async () => {
    failWith = null;
    archivedColumnMissing = false;
    tenantRows = [
      { id: 'live', sautikit_virtual_number: '+254700000001', is_active: true, archived_at: null },
      { id: 'gone', sautikit_virtual_number: '254700000002', is_active: false, archived_at: '2026-10-09T09:00:00Z' },
      { id: 'paused', sautikit_virtual_number: '+254700000003', is_active: false, archived_at: null },
    ];
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000002' }), { closed: true, reason: 'archived', tenantId: 'gone' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000003' }), { closed: true, reason: 'inactive', tenantId: 'paused' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000001' }), { closed: false, reason: 'live', tenantId: 'live' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254799999999' }), { closed: false, reason: 'no_tenant', tenantId: null });
  });

  it('works before archived_at exists (is_active only)', async () => {
    archivedColumnMissing = true;
    tenantRows = [{ id: 'paused', sautikit_virtual_number: STAGING_DID, is_active: false, archived_at: 'ignored' }];
    assert.deepEqual(await db.inboundTenantLine({ toNumber: STAGING_DID }), { closed: true, reason: 'inactive', tenantId: 'paused' });
    archivedColumnMissing = false;
  });

  it('fails open on a lookup error or no number', async () => {
    failWith = 'connection reset';
    assert.equal((await db.inboundTenantLine({ toNumber: STAGING_DID })).closed, false);
    failWith = null;
    assert.equal((await db.inboundTenantLine({})).closed, false);
  });
});

describe('server wiring: the gate runs before Stream, the call row and minutes', () => {
  const start = SERVER.indexOf('async function handleVoiceIncoming(');
  const body = SERVER.slice(start, SERVER.indexOf('\n}\n', start));
  it('order: telephony reject, tenant line, package gate, call row, Stream', () => {
    const at = (needle) => {
      const i = body.indexOf(needle);
      assert.ok(i > 0, needle);
      return i;
    };
    const reject = at('telephonyBillingRejectXml()');
    const line = at('await db.inboundTenantLine({ toNumber, fromNumber })');
    const pkg = at('db.packageInboundOpen(');
    const row = at('await db.upsertCall(');
    const stream = at('buildAnswerStreamXml(');
    assert.ok(reject < line && line < pkg && pkg < row && row < stream);
  });
  it('a closed line returns the line-unavailable XML and nothing else runs', () => {
    assert.match(body, /if \(line && line\.closed === true\) \{[\s\S]{0,200}return res\.type\('text\/xml'\)\.send\(await lineUnavailableResponse\(\)\);/);
    // A failed check answers (fail open), it does not throw out of the handler.
    assert.match(body, /catch \(lineErr\) \{\s*console\.warn\('\[voice\/incoming\] tenant line check failed \(answering\):/);
  });
});
