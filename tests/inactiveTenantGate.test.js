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
  isTenantLineInactive,
  tenantLineInactiveReason,
  tenantLineState,
  lineUnavailableXml,
  lineUnavailableResponse,
  usableClipUrl,
  resetClipProbeCache,
} = require('../src/sautikit/inactiveTenantGate');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const STAGING_DID = '+254709221537';

// Stub the Supabase client before db.js loads (no network, no env).
let tenantRows = [];
let failWith = null;
let archivedColumnMissing = false;
let lineStatusColumnMissing = false;
const selects = [];
function fakeSupabase() {
  return {
    from(table) {
      assert.equal(table, 'tenants');
      return {
        select(cols) {
          selects.push(cols);
          let result;
          if (failWith) result = { data: null, error: { message: failWith } };
          else if (archivedColumnMissing && /archived_at/.test(cols)) {
            result = { data: null, error: { message: 'column tenants.archived_at does not exist' } };
          } else if (lineStatusColumnMissing && /line_status/.test(cols)) {
            result = { data: null, error: { message: 'column tenants.line_status does not exist' } };
          } else {
            const keep = cols.split(',').map((c) => c.trim());
            const data = tenantRows.map((row) => Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]])));
            result = { data, error: null };
          }
          const query = Promise.resolve(result);
          // resolveTenantId: .eq('sautikit_virtual_number', n).maybeSingle()
          query.eq = (col, value) => ({
            maybeSingle: async () => {
              if (result.error) return result;
              const hit = result.data.find((row) => row[col] === value);
              return { data: hit || null, error: null };
            },
          });
          return query;
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

describe('isTenantLineInactive: one predicate for a closed line', () => {
  it('archived_at set, line_status suspended, or is_active false close the line', () => {
    assert.equal(isTenantLineInactive({ id: 'a', is_active: true, archived_at: '2026-10-09T18:00:00Z' }), true);
    assert.equal(isTenantLineInactive({ id: 'a', is_active: true, line_status: 'suspended' }), true);
    assert.equal(isTenantLineInactive({ id: 'a', is_active: true, line_status: ' Suspended ' }), true);
    assert.equal(isTenantLineInactive({ id: 'a', is_active: false }), true);
    assert.equal(tenantLineInactiveReason({ is_active: false, line_status: 'suspended', archived_at: 'x' }), 'archived');
    assert.equal(tenantLineInactiveReason({ is_active: false, line_status: 'suspended' }), 'suspended');
    assert.equal(tenantLineInactiveReason({ is_active: false, line_status: 'active' }), 'inactive');
  });

  it('active, grace, missing columns and null rows stay live', () => {
    assert.equal(isTenantLineInactive({ id: 'a', is_active: true, archived_at: null, line_status: 'active' }), false);
    assert.equal(isTenantLineInactive({ id: 'a', is_active: true, line_status: 'grace' }), false, 'grace still answers');
    assert.equal(isTenantLineInactive({ id: 'a' }), false);
    assert.equal(isTenantLineInactive(null), false);
    assert.equal(tenantLineInactiveReason(undefined), null);
  });
});

describe('tenantLineState', () => {
  it('a suspended owner closes the line; archived wins the reason over suspended / inactive', () => {
    assert.deepEqual(tenantLineState([{ id: 's', is_active: true, line_status: 'suspended' }]), { closed: true, reason: 'suspended', tenantId: 's' });
    assert.deepEqual(
      tenantLineState([{ id: 'p', is_active: false }, { id: 's', line_status: 'suspended' }, { id: 'g', archived_at: 'x' }]),
      { closed: true, reason: 'archived', tenantId: 'g' }
    );
    assert.deepEqual(tenantLineState([{ id: 'g', line_status: 'grace', is_active: true }]), { closed: false, reason: 'live', tenantId: 'g' });
  });

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
    const xml = lineUnavailableXml();
    assert.equal(
      xml,
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Say language="en-US">${LINE_UNAVAILABLE_EN}</Say><Say language="sw-KE">${LINE_UNAVAILABLE_SW}</Say><Hangup/></Response>`
    );
    assert.doesNotMatch(xml, /Stream|Connect/);
    assert.doesNotMatch(LINE_UNAVAILABLE_EN + LINE_UNAVAILABLE_SW, /downtime|outage|call back/i, 'not an outage message');
  });

  it('approved copy, same words as the recorded clips', () => {
    assert.equal(LINE_UNAVAILABLE_EN, 'Hello. This line is not available right now. Thank you for calling.');
    assert.equal(LINE_UNAVAILABLE_SW, 'Habari. Nambari hii haipatikani kwa sasa. Asante kwa kupiga.');
  });

  it('plays checked clips; ignores non-https values', () => {
    const xml = lineUnavailableXml({ clips: { en: 'https://storage.sautikit.com/a/en.wav', sw: 'javascript:alert(1)' } });
    assert.match(xml, /<Play>https:\/\/storage\.sautikit\.com\/a\/en\.wav<\/Play><Say language="sw-KE">/);
    assert.match(xml, /<Hangup\/><\/Response>$/);
  });
});

describe('clip fallback: <Say> unless the stored clip is on SautiKit storage and fetchable', () => {
  const EN = 'https://storage.sautikit.com/ws/line-en.wav?X-Amz-Signature=secret';
  const SW = 'https://storage.sautikit.com/ws/line-sw.wav?X-Amz-Signature=secret';
  const SAY_EN = `<Say language="en-US">${LINE_UNAVAILABLE_EN}</Say>`;
  const SAY_SW = `<Say language="sw-KE">${LINE_UNAVAILABLE_SW}</Say>`;
  const audio = (status = 206, type = 'audio/wav') => ({ status, headers: { get: () => type }, body: null });
  const stored = (urls) => async () => urls;
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

  it('nothing stored: <Say> both, no network', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio());
    const xml = await lineUnavailableResponse({ loadClipUrls: stored({ en: '', sw: '' }), fetchImpl: f, log: quiet });
    assert.ok(xml.includes(SAY_EN + SAY_SW + '<Hangup/>'));
    assert.equal(f.calls.length, 0);
  });

  it('store lookup throws: <Say> both, never throws', async () => {
    const xml = await lineUnavailableResponse({ loadClipUrls: async () => { throw new Error('db down'); }, log: quiet });
    assert.ok(xml.includes(SAY_EN + SAY_SW + '<Hangup/>'));
  });

  it('fetchable stored clips: <Play> both; probe is a ranged GET with a timeout signal', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio());
    const xml = await lineUnavailableResponse({ loadClipUrls: stored({ en: EN, sw: SW }), fetchImpl: f, log: quiet });
    assert.match(xml, /<Response><Play>https:\/\/storage\.sautikit\.com\/ws\/line-en\.wav\?X-Amz-Signature=secret<\/Play><Play>https:\/\/storage\.sautikit\.com\/ws\/line-sw\.wav/);
    assert.match(xml, /<Hangup\/><\/Response>$/);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].init.method, 'GET');
    assert.equal(f.calls[0].init.headers.Range, 'bytes=0-0');
    assert.ok(f.calls[0].init.signal);
  });

  it('a host other than storage.sautikit.com: <Say> without probing', async () => {
    resetClipProbeCache();
    const f = fakeFetch(() => audio(200, 'audio/mpeg'));
    const logs = [];
    assert.equal(await usableClipUrl('https://www.scalers.co.ke/audio/x.wav', { fetchImpl: f, log: (m) => logs.push(m) }), '');
    assert.equal(f.calls.length, 0);
    assert.match(logs[0], /www\.scalers\.co\.ke is not storage\.sautikit\.com/);
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
      const f = fakeFetch((u, init) => (u === EN ? handler(u, init) : audio()));
      const xml = await lineUnavailableResponse({ loadClipUrls: stored({ en: EN, sw: SW }), fetchImpl: f, timeoutMs: 20, log: (m) => logs.push(m) });
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
    const opts = { fetchImpl: f, now, log: quiet };
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
    const xml = await lineUnavailableResponse({ loadClipUrls: stored({ en: EN }), fetchImpl: 'nope', log: quiet });
    assert.ok(xml.includes(SAY_EN + SAY_SW));
  });

  it('no clip URL env vars or host allow-list var remain', () => {
    const gate = fs.readFileSync(path.join(__dirname, '..', 'src', 'sautikit', 'inactiveTenantGate.js'), 'utf8');
    assert.doesNotMatch(gate, /VOICE_LINE_UNAVAILABLE_CLIP_URL|VOICE_PLAY_ALLOWED_HOSTS|CLIP_BASE_URL|process\.env/);
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

  it('archived but still is_active = true (Admin Archive keeps the flag): closed, returns the archived tenant itself', async () => {
    tenantRows = [
      { id: 'other', sautikit_virtual_number: '+254700000009', is_active: true, archived_at: null, line_status: 'active' },
      { id: 'archived', sautikit_virtual_number: STAGING_DID, is_active: true, archived_at: '2026-10-09T18:00:00Z', line_status: 'active' },
    ];
    assert.deepEqual(await db.inboundTenantLine({ toNumber: STAGING_DID }), { closed: true, reason: 'archived', tenantId: 'archived' });
    // 254… / 0… forms of the same number find the same archived tenant, never 'other'.
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '254709221537' }), { closed: true, reason: 'archived', tenantId: 'archived' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '0709221537' }), { closed: true, reason: 'archived', tenantId: 'archived' });
  });

  it('suspended (line_status) closes; grace and active answer unchanged', async () => {
    tenantRows = [
      { id: 'susp', sautikit_virtual_number: '+254700000004', is_active: true, archived_at: null, line_status: 'suspended' },
      { id: 'grace', sautikit_virtual_number: '+254700000005', is_active: true, archived_at: null, line_status: 'grace' },
      { id: 'live', sautikit_virtual_number: '+254700000006', is_active: true, archived_at: null, line_status: 'active' },
    ];
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000004' }), { closed: true, reason: 'suspended', tenantId: 'susp' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000005' }), { closed: false, reason: 'live', tenantId: 'grace' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254700000006' }), { closed: false, reason: 'live', tenantId: 'live' });
  });

  it('prod schema today (line_status, no archived_at) and the oldest schema (is_active only) both work', async () => {
    tenantRows = [{ id: 'susp', sautikit_virtual_number: STAGING_DID, is_active: true, archived_at: 'not-on-prod', line_status: 'suspended' }];
    archivedColumnMissing = true;
    assert.deepEqual(await db.inboundTenantLine({ toNumber: STAGING_DID }), { closed: true, reason: 'suspended', tenantId: 'susp' });
    lineStatusColumnMissing = true;
    assert.deepEqual(await db.inboundTenantLine({ toNumber: STAGING_DID }), { closed: false, reason: 'live', tenantId: 'susp' }, 'unknown state never closes');
    archivedColumnMissing = false;
    lineStatusColumnMissing = false;
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
    assert.match(body, /if \(line && line\.closed === true\) \{[\s\S]{0,300}return res\.type\('text\/xml'\)\.send\(await lineUnavailableResponse\(\)\);/);
    // A failed check answers (fail open), it does not throw out of the handler.
    assert.match(body, /catch \(lineErr\) \{\s*console\.warn\('\[voice\/incoming\] tenant line check failed \(answering\):/);
  });
});

describe('db.resolveTenantId: an archived owner resolves to itself, never unassigned or another tenant', () => {
  it('digit-form match finds an archived / inactive owner; a live owner of the same digits wins', async () => {
    failWith = null;
    tenantRows = [
      { id: 'other', sautikit_virtual_number: '+254700000009', is_active: true, archived_at: null, line_status: 'active' },
      { id: 'archived', sautikit_virtual_number: '254709221537', is_active: false, archived_at: '2026-10-09T18:00:00Z', line_status: 'active' },
    ];
    assert.equal(await db.resolveTenantId({ toNumber: STAGING_DID }), 'archived');
    tenantRows.push({ id: 'newOwner', sautikit_virtual_number: '0709221537', is_active: true, archived_at: null, line_status: 'active' });
    assert.equal(await db.resolveTenantId({ toNumber: STAGING_DID }), 'newOwner');
  });

  it('active tenants resolve exactly as before; an unknown number is still unassigned_did', async () => {
    tenantRows = [{ id: 'live', sautikit_virtual_number: '+254700000001', is_active: true, archived_at: null, line_status: 'active' }];
    assert.equal(await db.resolveTenantId({ toNumber: '+254700000001' }), 'live');
    assert.equal(await db.resolveTenantId({ toNumber: '254700000001' }), 'live');
    await assert.rejects(db.resolveTenantId({ toNumber: '+254711111111' }), (err) => err.code === 'unassigned_did');
  });
});

describe('prod replay: the three prod tenants (snapshot 2026-10-09 EAT) answer exactly as before', () => {
  // Read-only snapshot of prod tenants (fjxcdccgyhnvnnlnovcl): every column the
  // gate reads, after admin_business_archive.sql. Ids shortened.
  const PROD = [
    { id: '24ca3d5e', business_name: 'Aris Kenya', sautikit_virtual_number: '+254709221536', is_active: true, line_status: 'active', archived_at: null },
    { id: 'c81b3480', business_name: 'Esga Stationery', sautikit_virtual_number: '+254709221542', is_active: true, line_status: 'active', archived_at: null },
    { id: 'f75588d4', business_name: 'Scalers Business Solutions', sautikit_virtual_number: 'pending:f75588d4-a98f-4d25-9e17-6c9fb536ec9d', is_active: true, line_status: 'active', archived_at: null },
  ];
  const schemas = [
    ['full (archived_at + line_status)', false, false],
    ['before admin_business_archive.sql (no archived_at)', true, false],
    ['oldest (is_active only)', true, true],
  ];
  for (const [label, noArchived, noLineStatus] of schemas) {
    it(`Aris +254709221536 and Esga stay live, resolve to themselves: ${label}`, async () => {
      failWith = null;
      archivedColumnMissing = noArchived;
      lineStatusColumnMissing = noLineStatus;
      tenantRows = PROD.map((r) => ({ ...r }));
      try {
        for (const to of ['+254709221536', '254709221536', '0709221536']) {
          assert.deepEqual(await db.inboundTenantLine({ toNumber: to, fromNumber: '+254722000000' }), { closed: false, reason: 'live', tenantId: '24ca3d5e' }, to);
          assert.equal(await db.resolveTenantId({ toNumber: to, fromNumber: '+254722000000' }), '24ca3d5e', to);
        }
        assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254709221542' }), { closed: false, reason: 'live', tenantId: 'c81b3480' });
        assert.equal(await db.resolveTenantId({ toNumber: '+254709221542' }), 'c81b3480');
        // The staging DID is not a prod tenant: unchanged (no tenant, not closed).
        assert.deepEqual(await db.inboundTenantLine({ toNumber: STAGING_DID }), { closed: false, reason: 'no_tenant', tenantId: null });
      } finally {
        archivedColumnMissing = false;
        lineStatusColumnMissing = false;
      }
    });
  }

  it('Admin Archive on prod (#636: is_active=false + archived_at) closes only that business', async () => {
    tenantRows = PROD.map((r) => (r.id === 'c81b3480' ? { ...r, is_active: false, archived_at: '2026-10-09T19:00:00Z' } : { ...r }));
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254709221542' }), { closed: true, reason: 'archived', tenantId: 'c81b3480' });
    assert.deepEqual(await db.inboundTenantLine({ toNumber: '+254709221536' }), { closed: false, reason: 'live', tenantId: '24ca3d5e' });
  });
});

describe('closed-line calls: later webhooks touch nothing', () => {
  const { createClosedLineCalls } = require('../src/sautikit/closedLineCalls');
  it('remembers gated sids for a TTL, bounded', () => {
    let t = 0;
    const memo = createClosedLineCalls({ ttlMs: 1000, now: () => t, max: 3 });
    memo.remember('a', '', null, 'b');
    assert.equal(memo.has('a'), true);
    assert.equal(memo.has(undefined, 'b'), true);
    assert.equal(memo.has('c'), false);
    t = 1001;
    assert.equal(memo.has('a'), false, 'expired');
    memo.remember('1', '2', '3', '4');
    assert.ok(memo.size <= 3);
    assert.equal(memo.has('4'), true);
  });

  it('server: gate remembers the call; incoming lifecycle and /voice/events short-circuit before any call-row, recording or alert work', () => {
    const start = SERVER.indexOf('async function handleVoiceIncoming(');
    const incoming = SERVER.slice(start, SERVER.indexOf('\n}\n', start));
    assert.match(incoming, /line\.closed === true\) \{[\s\S]{0,300}closedLineCalls\.remember\(sid, callSid, extracted\.callSid\);[\s\S]{0,80}lineUnavailableResponse\(\)/);
    const memo = incoming.indexOf('closedLineCalls.has(sid, callSid)');
    assert.ok(memo > 0 && memo < incoming.indexOf('shouldSkipMediaStream('), 'checked before lifecycle handling');
    assert.ok(memo < incoming.indexOf('markCallTerminalFromWebhook('));
    const ev = SERVER.indexOf("app.post('/voice/events'");
    const events = SERVER.slice(ev, SERVER.indexOf('\n});\n', ev));
    const skip = events.indexOf('closedLineCalls.has(callSid');
    assert.ok(skip > 0);
    for (const later of ['attachProviderRecording(', 'markCallTerminalFromWebhook(', 'maybeSendWhatsAppNotification(', 'scheduleRecordingFetch(']) {
      assert.ok(skip < events.indexOf(later), later);
    }
  });

  it('archived call: the gate answers with clip + Hangup and no Stream / session / call row; active call: unchanged path', () => {
    const start = SERVER.indexOf('async function handleVoiceIncoming(');
    const incoming = SERVER.slice(start, SERVER.indexOf('\n}\n', start));
    const gate = incoming.indexOf('await db.inboundTenantLine(');
    const closedReturn = incoming.indexOf('return res.type(\'text/xml\').send(await lineUnavailableResponse());');
    // Everything that starts a session, writes a lead/call row, charges minutes or alerts comes after the closed return.
    for (const later of ['db.packageInboundOpen(', 'await db.upsertCall(', 'buildAnswerStreamXml(']) {
      const i = incoming.indexOf(later);
      assert.ok(i > closedReturn && closedReturn > gate, later);
    }
  });
});

// #645 (VOICE_FAST_INBOUND) adds an in-memory DID -> tenant directory. The
// closed-line decision above does NOT depend on it: handleVoiceIncoming asks
// db.inboundTenantLine (a direct read) before Stream on every call. These run
// only when the directory is in the build (combined staging), and pin the
// contract #645 must keep so it never routes an archived line as live.
describe('#645 inbound directory contract (runs when src/sautikit/inboundDirectory.js is present)', () => {
  const dirPath = path.join(__dirname, '..', 'src', 'sautikit', 'inboundDirectory.js');
  const present = fs.existsSync(dirPath);
  it('an archived owner is reported closed (line.archived), never swapped for another tenant', { skip: !present && 'no #645 directory in this build' }, async () => {
    const { createInboundDirectory } = require(dirPath);
    const dir = createInboundDirectory({
      loadTenants: async () => ({
        rows: [
          { id: 'other', sautikit_virtual_number: '+254700000009', is_active: true, archived_at: null },
          { id: 'archived', sautikit_virtual_number: STAGING_DID, is_active: true, archived_at: '2026-10-09T18:00:00Z' },
        ],
        packageColumns: false,
      }),
    });
    const hit = await dir.lookup({ toNumber: STAGING_DID, fromNumber: '+254711000000' });
    assert.equal(hit.tenantId, 'archived');
    assert.ok(hit.line && (hit.line.archived === true || hit.line.closed === true));
  });
  it('TODO #645: directory uses isTenantLineInactive (line_status suspended) so the gate can skip its DB read', { todo: true }, () => {});
});
