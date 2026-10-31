'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COPY } = require('../dashboard/src/components/marketing/voiceDemo/copy.ts');
const {
  DEMO_MAX_SEC,
  DEMO_STATES,
  formatCountdown,
  stateForTokenFailure,
} = require('../dashboard/src/components/marketing/voiceDemo/machine.ts');
const { endedLine } = require('../dashboard/src/components/marketing/voiceDemo/copy.ts');
const { blockFromStatus, readDemoStatus } = require('../dashboard/src/components/marketing/voiceDemo/status.ts');
const { REQUEST_ACCESS_COPY } = require('../dashboard/src/components/marketing/voiceDemo/requestAccessCopy.ts');
const {
  createMockRequestAccessAdapter,
  normalizeRequestPhone,
  submitRequestAccess,
  validateRequestAccess,
} = require('../dashboard/src/components/marketing/voiceDemo/requestAccess.ts');
const { preferredDemoCodec } = require('../dashboard/src/components/marketing/voiceDemo/protocol.ts');
const {
  DEMO_TENANT_IDS,
  acceptSession,
  demoSocketUrl,
  parseServerMessage,
  stateForUpgrade,
  stopsPlayback,
} = require('../dashboard/src/components/marketing/voiceDemo/protocol.ts');
const { encodePcm16Frame, framesFromFloat } = require('../dashboard/src/components/marketing/voiceDemo/pcm.ts');

const EXACT = {
  disabled: 'Demo paused.',
  busy: 'All demo lines are busy, try again in a minute.',
  limit: "You've used today's demos.",
};

describe('voice demo widget states', () => {
  for (const state of DEMO_STATES) {
    it(`${state} has English and Kiswahili copy`, () => {
      const en = textFor(state, 'en');
      const sw = textFor(state, 'sw');
      assert.ok(en && en.length > 1, state);
      assert.ok(sw && sw.length > 1, state);
      assert.equal(en.includes('—') || en.includes('–'), false);
      assert.equal(sw.includes('—') || sw.includes('–'), false);
      assert.equal(en.includes('!'), false);
      assert.equal(sw.includes('!'), false);
    });
  }

  it('shows the paused and busy lines from the token contract', () => {
    assert.equal(stateForTokenFailure(503, 'disabled'), 'disabled');
    assert.equal(COPY.en.paused, EXACT.disabled);
    assert.equal(stateForTokenFailure(503, 'busy'), 'busy');
    assert.equal(stateForTokenFailure(503, 'cap'), 'cap');
    assert.equal(COPY.en.resting, 'The demo is resting for today. Try again tomorrow.');
    assert.equal(COPY.en.endedBy.kill, 'Demo paused.');
    assert.equal(COPY.en.endedBy.cap, COPY.en.resting);
    assert.equal(COPY.en.busy, EXACT.busy);
    assert.equal(stateForTokenFailure(429, 'used'), 'request');
    assert.notEqual(stateForTokenFailure(429, 'used'), 'limit');
    assert.notEqual(stateForTokenFailure(429, 'used'), 'busy');
    assert.notEqual(stateForTokenFailure(429, 'used'), 'rate');
    assert.equal(stateForTokenFailure(429, 'rate'), 'rate');
    assert.notEqual(stateForTokenFailure(429, 'rate'), 'request');
    assert.notEqual(stateForTokenFailure(429, 'rate'), 'limit');
    assert.equal(COPY.en.rate, 'A demo is already open. Try again in a minute.');
    assert.equal(stateForTokenFailure(429, 'limit_daily'), 'limit');
    assert.equal(COPY.en.limit, EXACT.limit);
    assert.notEqual(stateForTokenFailure(429, 'limit_daily'), 'busy');
    assert.equal(stateForTokenFailure(403, 'origin'), 'error');
    assert.equal(stateForTokenFailure(403, 'turnstile'), 'error');
    assert.equal(stateForTokenFailure(403, 'tenant'), 'error');
  });

  it('counts down from three minutes', () => {
    assert.equal(DEMO_MAX_SEC, 180);
    assert.equal(formatCountdown(180), '3:00');
    assert.equal(formatCountdown(65), '1:05');
    assert.equal(formatCountdown(0), '0:00');
  });

  it('maps each upgrade failure onto a widget state', () => {
    assert.equal(stateForUpgrade(404, 'disabled'), 'disabled');
    assert.equal(stateForUpgrade(403, 'origin'), 'error');
    assert.equal(stateForUpgrade(400, 'codec'), 'unsupported');
    for (const reason of ['rejected', 'expired', 'reused', 'tenant']) {
      assert.equal(stateForUpgrade(401, reason), 'error');
      assert.ok(COPY.en.upgrade[reason]);
      assert.ok(COPY.sw.upgrade[reason]);
    }
  });

  it('gives each end reason its own line', () => {
    const seen = new Set();
    for (const reason of ['max_time', 'idle', 'user', 'cap', 'kill', 'error']) {
      const en = endedLine(reason, 'en');
      const sw = endedLine(reason, 'sw');
      assert.ok(en && sw);
      assert.equal(seen.has(en), false, en);
      seen.add(en);
      assert.equal(en.includes('—') || sw.includes('—'), false);
    }
    assert.equal(endedLine('user', 'en'), 'Thanks. The demo has ended.');
    assert.equal(endedLine('max_time', 'en'), "That's three minutes. Thanks.");
    assert.equal(endedLine('cap', 'en'), 'The demo is resting for today. Try again tomorrow.');
    assert.equal(endedLine('kill', 'en'), 'Demo paused.');
  });

  it('reads demo status before start and stays quiet on a rate limit', async () => {
    assert.equal(blockFromStatus({ enabled: false, busy: true, cap: true, reason: 'used' }), 'disabled');
    assert.equal(blockFromStatus({ enabled: true, busy: true, cap: true, reason: 'used' }), 'cap');
    assert.equal(blockFromStatus({ enabled: true, busy: true, cap: false, reason: 'used' }), 'request');
    assert.equal(blockFromStatus({ enabled: true, busy: true, cap: false, reason: 'busy' }), 'busy');
    assert.equal(blockFromStatus({ enabled: false, busy: false, cap: false, reason: 'disabled' }), 'disabled');
    assert.equal(blockFromStatus({ enabled: true, busy: false, cap: true, reason: 'cap' }), 'cap');
    assert.equal(blockFromStatus({ enabled: true, busy: true, cap: false, reason: 'busy' }), 'busy');
    assert.equal(blockFromStatus({ enabled: true, busy: false, cap: false, reason: null }), null);
    assert.equal(blockFromStatus({ enabled: true, reason: 'used' }), 'request');
    const used = await readDemoStatus(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ enabled: true, busy: false, cap: false, reason: 'used' }),
    }), '/demo/status');
    assert.deepEqual(used, { kind: 'block', state: 'request' });
    const rate = await readDemoStatus(async () => ({ status: 429, json: async () => ({ reason: 'rate' }) }), '/demo/status');
    assert.equal(rate.kind, 'quiet');
    const paused = await readDemoStatus(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ enabled: false, busy: false, cap: false, reason: 'disabled' }),
    }), '/demo/status');
    assert.deepEqual(paused, { kind: 'block', state: 'disabled' });
  });

  it('accepts a Kenya phone or an email, and the access stub does not call the network', async () => {
    assert.equal(validateRequestAccess({ name: '  ', contact: '0712345678', consent: true }).ok, false);
    assert.equal(validateRequestAccess({ name: 'Amina', contact: '', consent: true }).error, 'contact');
    assert.equal(validateRequestAccess({ name: 'Amina', contact: '0712345678', consent: false }).error, 'consent');
    assert.equal(validateRequestAccess({ name: 'Amina', contact: 'not-a-contact', consent: true }).error, 'contact_invalid');
    const local = validateRequestAccess({ name: 'Amina', contact: '0712 345 678', consent: true });
    assert.equal(local.ok && local.value.contact, '+254712345678');
    assert.equal(local.ok && local.value.kind, 'phone');
    assert.equal(normalizeRequestPhone('+254712345678'), '+254712345678');
    assert.equal(normalizeRequestPhone('254712345678'), '+254712345678');
    assert.equal(normalizeRequestPhone('712345678'), '+254712345678');
    const mail = validateRequestAccess({ name: 'Amina', contact: 'Amina@Shop.co', consent: true });
    assert.equal(mail.ok && mail.value.kind, 'email');
    assert.equal(mail.ok && mail.value.contact, 'amina@shop.co');
    let called = false;
    const adapter = createMockRequestAccessAdapter();
    const original = adapter.submitRequestAccess;
    adapter.submitRequestAccess = async (input) => {
      called = true;
      assert.equal(input.name, 'Amina');
      await original(input);
    };
    await submitRequestAccess(adapter, { name: 'Amina', contact: '+254712345678', kind: 'phone' });
    assert.equal(called, true);
    const src = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/components/marketing/voiceDemo/requestAccess.ts'),
      'utf8',
    );
    assert.doesNotMatch(src, /fetch\(|supabase|localStorage/);
  });

  it('uses pcm8 on touch or a phone and pcm16 on a desktop', () => {
    assert.equal(preferredDemoCodec({ coarsePointer: true }), 'pcm8');
    assert.equal(preferredDemoCodec({ touchPoints: 1 }), 'pcm8');
    assert.equal(preferredDemoCodec({ narrow: true }), 'pcm8');
    assert.equal(preferredDemoCodec({}), 'pcm16');
    const mobile = framesFromFloat(new Float32Array(8000), 8000, 0, 8000);
    assert.equal(mobile.frames.length, 50);
    assert.equal(mobile.frames[0].byteLength, 320);
  });

  it('opens pcm16 by default and only accepts the three demo tenants', () => {
    const url = demoSocketUrl('wss://voice.example/ws/demo?t=abc', 'pcm16');
    assert.match(url, /codec=pcm16/);
    assert.match(demoSocketUrl('wss://voice.example/ws/demo?t=abc', 'pcm8'), /codec=pcm8/);
    assert.equal(url.includes('opus'), false);
    assert.match(url, /t=abc/);
    const fixture = require('../fixtures/demo-tenants.json');
    const ids = fixture.tenants.map((row) => row.id).sort();
    assert.deepEqual(Object.values(DEMO_TENANT_IDS).sort(), ids);
    const session = parseServerMessage(JSON.stringify({
      type: 'session',
      tenant_id: DEMO_TENANT_IDS.demo_shop,
      max_sec: 180,
      recording: false,
      lang: 'en',
      codec: 'pcm16',
    }));
    assert.equal(session.type, 'session');
    assert.deepEqual(acceptSession(session), { ok: true, maxSec: 180 });
    assert.equal(acceptSession({ ...session, tenantId: 'not-a-demo' }).ok, false);
    assert.equal(acceptSession({ ...session, recording: true }).ok, false);
    assert.equal(stopsPlayback('listening'), true);
    assert.equal(stopsPlayback('speaking'), false);
    const end = parseServerMessage('{"type":"end","reason":"idle"}');
    assert.equal(end.reason, 'idle');
    const caption = parseServerMessage('{"type":"caption","role":"assistant","text":"Hello","final":true,"lang":"en"}');
    assert.equal(caption.text, 'Hello');
    assert.equal(caption.final, true);
  });

  it('packs 20 ms mic frames as 640-byte little-endian pcm16', () => {
    const one = encodePcm16Frame(new Float32Array(320));
    assert.equal(one.byteLength, 640);
    const second = framesFromFloat(new Float32Array(16000), 16000);
    assert.equal(second.frames.length, 50);
    assert.equal(second.frames[0].byteLength, 640);
    const partial = framesFromFloat(new Float32Array(100), 16000);
    assert.equal(partial.frames.length, 0);
    const opus = demoSocketUrl('wss://voice.example/ws/demo?t=abc', 'opus');
    assert.match(opus, /codec=opus/);
    const widget = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/components/marketing/voiceDemo/socket.ts'),
      'utf8',
    );
    assert.match(widget, /demoSocketUrl\(wsUrl, codec\)/);
    assert.match(widget, /readDemoStatus/);
    assert.match(widget, /type: "end"/);
    assert.doesNotMatch(widget, /localStorage|MediaRecorder|getEntriesByType|responseStatus/);
  });

  it('does not paint orange or record audio in the widget', () => {
    const dir = path.join(__dirname, '../dashboard/src/components/marketing/voiceDemo');
    const blob = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
    assert.equal(/MediaRecorder|attention|orange|#[fF]{2}[0-9a-fA-F]{4}/.test(blob), false);
    assert.match(blob, /echoCancellation: true/);
    assert.match(blob, /createHttpDemoAdapter/);
    assert.match(blob, /createMockDemoAdapter/);
  });
});

function textFor(state, lang) {
  const copy = COPY[lang];
  const map = {
    idle: copy.title,
    consent: copy.notice,
    mic_denied: copy.denied,
    connecting: copy.connecting,
    live: copy.live,
    ended: copy.ended,
    disabled: copy.paused,
    busy: copy.busy,
    cap: copy.resting,
    rate: copy.rate,
    request: REQUEST_ACCESS_COPY[lang].title,
    requested: REQUEST_ACCESS_COPY[lang].thanks,
    limit: copy.limit,
    error: copy.error,
    unsupported: copy.unsupported,
  };
  return map[state];
}
