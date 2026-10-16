'use strict';
// VOICE_OUTAGE_DEBOUNCE: a single TTS failure is never a speech outage (live miss HD_30a3970034a4).
const { test } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createOutageGate, probeReady, outageDebounceEnabled } = require('../src/speech/outageDebounce');
const N = require('../src/speech/speechOutageNotify');

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/outage/HD_30a3970034a4.json'), 'utf8'));
const withEnv = async (env, fn) => {
  const old = {}; for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};

/**
 * Mirrors server.js handleSpeechProviderOutage with the flag on: gate, one reconnect probe, then clip + notify.
 * The server wiring itself is pinned by the source checks at the bottom.
 */
async function replayCall(fx, { reconnectOk = true, now } = {}) {
  let clock = 0; const gate = createOutageGate({ now: now || (() => clock) });
  let mediaOpen = true; let tts = 'session'; const out = { clips: 0, sms: [], spoken: [], decisions: [] };
  N.resetSpeechOutageNotify(); N.setSpeechOutageDispatch(async (m) => { out.sms.push(m); return { channel: 'sms' }; });
  const outage = async (reason, classified) => {
    let d = gate.fail(reason, { ...(classified || {}), closed: !mediaOpen }); out.decisions.push(d.action);
    if (d.action === 'retry') {
      if (reconnectOk) { tts = 'session2'; return { recovered: true }; }
      d = gate.fail(reason, { probeFailed: true, closed: !mediaOpen }); out.decisions.push(d.action);
    }
    if (d.action === 'ignore_closed') return { closed: true };
    out.clips += 1;
    await N.noteSpeechOutage({ profile: { id: fx.tenant, businessName: fx.business, whatsappNumber: '+254700000000' }, confirmed: gate.confirmed() });
    return { outage: true };
  };
  const speak = async (text, retry = false) => {
    if (!tts) { const r = await outage('tts unavailable'); if (r.recovered && !retry) return speak(text, true); return r; }
    out.spoken.push(text); gate.ok(); return { ok: true };
  };
  for (const e of fx.events) {
    clock = e.t;
    if (e.type === 'ws_close') { mediaOpen = false; gate.markClosed(); tts = null; }
    if (e.type === 'tts_closed') tts = null;
    if (e.type === 'tts_drop') tts = null;
    if (e.type === 'speak') { if (e.tts === null) tts = null; await speak(e.text); }
  }
  return out;
}

test('HD_30a3970034a4 replay: speak after hang-up is not an outage (no clip, no owner SMS)', () => withEnv({ VOICE_OUTAGE_DEBOUNCE: '1' }, async () => {
  const out = await replayCall(FX);
  assert.deepStrictEqual(out.decisions, [FX.expectedWithFlag.decision]);
  assert.strictEqual(out.clips > 0, FX.expectedWithFlag.downtimeClip);
  assert.strictEqual(out.sms.length > 0, FX.expectedWithFlag.ownerSms);
}));

test('live call, one dead stream: reconnect once and re-speak the line; no clip, no SMS', () => withEnv({ VOICE_OUTAGE_DEBOUNCE: '1' }, async () => {
  const fx = { ...FX, events: [{ t: 0, type: 'tts_drop' }, { t: 100, type: 'speak', text: 'Am I speaking with Alvin Yegon?' }] };
  const out = await replayCall(fx);
  assert.deepStrictEqual(out.decisions, ['retry']);
  assert.deepStrictEqual(out.spoken, ['Am I speaking with Alvin Yegon?']);
  assert.strictEqual(out.clips, 0); assert.strictEqual(out.sms.length, 0);
}));

test('live call, reconnect probe fails: confirmed outage, clip and exactly one owner SMS', () => withEnv({ VOICE_OUTAGE_DEBOUNCE: '1' }, async () => {
  const fx = { ...FX, events: [{ t: 0, type: 'tts_drop' }, { t: 100, type: 'speak', text: 'Hello?' }, { t: 200, type: 'speak', text: 'Hello?' }] };
  const out = await replayCall(fx, { reconnectOk: false });
  assert.deepStrictEqual(out.decisions.slice(0, 2), ['retry', 'outage']);
  assert.strictEqual(out.sms.length, 1, 'cooldown dedupes the second alert');
}));

test('gate: N consecutive failures inside the window confirm; a success or an expired window resets', () => {
  let t = 0; const g = createOutageGate({ threshold: 2, windowMs: 1000, now: () => t });
  assert.strictEqual(g.fail('a').action, 'retry');
  g.ok(); t = 10; assert.strictEqual(g.fail('b').action, 'retry');
  t = 2000; assert.strictEqual(g.fail('c').action, 'retry', 'old failure fell out of the window');
  t = 2100; const d = g.fail('d'); assert.strictEqual(d.action, 'outage'); assert.strictEqual(d.why, 'consecutive_2');
  assert.ok(g.confirmed());
});

test('gate: provider billing/auth confirms at once; a closed call never does', () => {
  const g = createOutageGate();
  assert.strictEqual(g.fail('tts 402', { billing: true }).why, 'provider_fatal');
  const h = createOutageGate(); h.markClosed();
  assert.strictEqual(h.fail('tts 402', { billing: true }).action, 'ignore_closed');
  assert.strictEqual(h.confirmed(), null);
});

test('notify: with the flag on, an unconfirmed speech alert is dropped; llm alerts are untouched', () => withEnv({ VOICE_OUTAGE_DEBOUNCE: '1' }, async () => {
  N.resetSpeechOutageNotify(); const sent = []; N.setSpeechOutageDispatch(async (m) => { sent.push(m); return { channel: 'sms' }; });
  const profile = { id: 't1', businessName: 'Aris Kenya', whatsappNumber: '+254700000000' };
  assert.strictEqual((await N.noteSpeechOutage({ profile })).reason, 'unconfirmed');
  assert.strictEqual((await N.noteSpeechOutage({ profile, kind: 'llm' })).ok, true);
  assert.strictEqual(sent.length, 1);
}));

test('notify: flag off keeps the old behaviour (no confirmation needed)', () => withEnv({ VOICE_OUTAGE_DEBOUNCE: null }, async () => {
  N.resetSpeechOutageNotify(); N.setSpeechOutageDispatch(async () => ({ channel: 'sms' }));
  assert.strictEqual(outageDebounceEnabled(), false);
  assert.strictEqual((await N.noteSpeechOutage({ profile: { id: 't2', businessName: 'X', whatsappNumber: '+254700000001' } })).ok, true);
}));

test('probeReady: ready, rejected and hung sessions', async () => {
  assert.strictEqual(await probeReady({ ready: Promise.resolve() }), true);
  assert.strictEqual(await probeReady({ ready: Promise.reject(new Error('x')) }), false);
  assert.strictEqual(await probeReady({ ready: new Promise(() => {}) }, 20), false);
  assert.strictEqual(await probeReady(null), false);
});

test('server wiring: ws close marks the gate, speakText re-speaks once, alert needs confirmation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /ws\.on\('close', \(code, reason\) => \{\n\s*outageGate\.markClosed\(\);/);
  assert.match(src, /if \(r\?\.recovered && !opts\.outageRetry\) return speakText\(text, \{ \.\.\.opts, outageRetry: true \}\);/);
  assert.match(src, /if \(r\?\.recovered && !opts\.outageRetry\) return speakGreetingSentences\(text, \{ \.\.\.opts, outageRetry: true \}\);/);
  assert.match(src, /confirmed: outageDebounce \? outageGate\.confirmed\(\) : undefined/);
  assert.match(src, /'default shop name', \{ classified: \{ fatal: true \}, notify: false \}/);
});
