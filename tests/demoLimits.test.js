'use strict';

// Demo session length, spend caps, kill switch, and restart-safe meter.
// Phone limits and the phone daily meter stay on their own path.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createCallLimits, maxCallMs, limitLine } = require('../src/speech/callLimits');
const { createCallMeter, dailyMeterTotals, demoMeterTotals, resetDailyMeter } = require('../src/speech/callMeter');
const { createDemoGuard, hashValue } = require('../src/demo/guards');
const { GOODBYE, CAP, KILL, createDemoSession } = require('../src/demo/session');
const {
  createDemoMeter,
  createDemoLedger,
  createMemorySpendStore,
  createSupabaseSpendStore,
  healthCounts,
  tokensFromChars,
  PCM_BYTES_PER_SEC,
} = require('../src/demo/meter');
const { spendPersistOn, dailyCapUsd, monthlyCapUsd } = require('../src/demo/flags');

const SALT = 'test-ip-salt';
const IP = '203.0.113.10';
const IP_HASH = '6e38ea0c936a2177adf40771c48c23cb7cd6299d8c46833cd5934ed407e0036c';
const DEVICE = 'device-1234';
const SID_A = 'demo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SID_B = 'demo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SID_C = 'demo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function spendEnv(over = {}) {
  return {
    DEMO_ENABLED: 'on',
    DEMO_DAILY_CAP_USD: '2',
    DEMO_MONTHLY_CAP_USD: '50',
    DEMO_IP_SALT: SALT,
    ...over,
  };
}

function usage(over = {}) {
  return {
    minutes: 1,
    sttSeconds: 60,
    ttsSeconds: 20,
    modelInputTokens: 10,
    modelOutputTokens: 20,
    costUsd: 0.02,
    ...over,
  };
}

function guardEnv(over = {}) {
  return {
    DEMO_ENABLED: 'on',
    DEMO_ALLOWED_ORIGINS: 'https://staging.example',
    DEMO_TOKEN_SECRET: 'test-token-secret',
    DEMO_IP_SALT: SALT,
    TURNSTILE_SECRET_KEY: 'turnstile-test',
    ...over,
  };
}

function request() {
  return {
    method: 'POST',
    headers: { origin: 'https://staging.example', host: 'voice.example', 'x-forwarded-proto': 'https' },
    body: {
      tenant: 'home',
      lang: 'en',
      turnstile: 'turnstile-client-token',
      device_id: DEVICE,
      consent_ts: 1760000000000,
      notice_v: '2026-10-31',
    },
    ip: IP,
  };
}

function fakeWs() {
  const handlers = {};
  const sent = [];
  return {
    readyState: 1,
    sent,
    on(event, fn) { handlers[event] = fn; },
    send(data) { sent.push(data); },
    close() {
      this.readyState = 3;
      if (handlers.close) handlers.close();
    },
    jsons() {
      return sent.filter((item) => typeof item === 'string').map((item) => JSON.parse(item));
    },
  };
}

function fakeSpeech() {
  const spoken = [];
  return {
    spoken,
    createStt() {
      return { sendAudio() {}, sendKeepalive() {}, close() {} };
    },
    createTts({ onAudio }) {
      return {
        speak(text) {
          spoken.push(String(text));
          if (onAudio) onAudio(Buffer.alloc(PCM_BYTES_PER_SEC));
          return Promise.resolve();
        },
        cancel() {},
        close() {},
      };
    },
  };
}

async function flush() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('caps and flags', () => {
  it('keeps spend flags off unless the value is exactly on, and defaults the dollar caps', () => {
    assert.equal(spendPersistOn({}), false);
    for (const value of ['', 'On', 'ON', 'true', '1', 'yes', 'on ']) {
      assert.equal(spendPersistOn({ DEMO_SPEND_PERSIST: value }), false, JSON.stringify(value));
    }
    assert.equal(spendPersistOn({ DEMO_SPEND_PERSIST: 'on' }), true);
    assert.equal(dailyCapUsd({}), 2);
    assert.equal(monthlyCapUsd({}), 50);
    assert.equal(dailyCapUsd({ DEMO_DAILY_CAP_USD: '1.25' }), 1.25);
    assert.equal(monthlyCapUsd({ DEMO_MONTHLY_CAP_USD: '40' }), 40);
    assert.equal(dailyCapUsd({ DEMO_DAILY_CAP_USD: '0' }), 0);
    assert.equal(dailyCapUsd({ DEMO_DAILY_CAP_USD: 'nope' }), 2);
    assert.equal(monthlyCapUsd({ DEMO_MONTHLY_CAP_USD: '' }), 50);
  });

  it('does not let a demo override change the phone max', async () => {
    assert.equal(maxCallMs({}), 1_200_000);
    assert.match(limitLine('maxCall', 'en'), /time limit/);
    let t = 0;
    const fired = [];
    const phone = createCallLimits({
      env: { VOICE_MAX_CALL: 'on', VOICE_MAX_CALL_SEC: '1200' },
      now: () => t,
      onLimit: (kind) => fired.push(kind),
      setInterval: () => 1,
      clearInterval() {},
    });
    t = 180_000;
    phone.check();
    assert.deepEqual(fired, []);
    t = 1_200_000;
    phone.check();
    await flush();
    assert.deepEqual(fired, ['maxCall']);
    const off = createCallLimits({ env: {}, onLimit() {}, setInterval: () => 1, clearInterval() {} });
    assert.equal(off.enabled, false);
    assert.equal(off.start(), false);
  });

  it('enforces 180s and 30s idle on a demo clock even when the phone flags are off', async () => {
    let t = 0;
    const fired = [];
    const lim = createCallLimits({
      env: {},
      maxCallMs: 180_000,
      deadAirMs: 30_000,
      now: () => t,
      onLimit: (kind) => fired.push(kind),
      setInterval: () => 1,
      clearInterval() {},
    });
    assert.equal(lim.enabled, true);
    assert.equal(lim.start(), true);
    t = 29_999;
    lim.check();
    assert.deepEqual(fired, []);
    lim.activity();
    t = 59_998;
    lim.check();
    assert.deepEqual(fired, []);
    t = 59_999;
    lim.check();
    await flush();
    assert.deepEqual(fired, ['deadAir']);

    let t2 = 0;
    const maxFired = [];
    const maxLim = createCallLimits({
      env: { VOICE_MAX_CALL: 'true', VOICE_DEAD_AIR_HANGUP: 'true' },
      maxCallMs: 180_000,
      deadAirMs: 30_000,
      now: () => t2,
      onLimit: (kind) => maxFired.push(kind),
      setInterval: () => 1,
      clearInterval() {},
    });
    t2 = 180_000;
    maxLim.check();
    await flush();
    assert.deepEqual(maxFired, ['maxCall']);
  });

  it('lets a kill or cap tick stop the session before the phone-style max fires', () => {
    let t = 0;
    const fired = [];
    const lim = createCallLimits({
      env: {},
      maxCallMs: 1000,
      deadAirMs: 30_000,
      now: () => t,
      onTick: () => true,
      onLimit: (kind) => fired.push(kind),
      setInterval: () => 1,
      clearInterval() {},
    });
    t = 5000;
    assert.equal(lim.check(), null);
    assert.deepEqual(fired, []);
  });
});

describe('demo meter', () => {
  it('prices STT, TTS, and model usage, and keeps that cost off the phone daily total', () => {
    resetDailyMeter();
    const meter = createDemoMeter();
    meter.noteStt(PCM_BYTES_PER_SEC * 60);
    meter.noteTts('Hello there.', PCM_BYTES_PER_SEC * 30);
    meter.noteModel('abcd', 'abcde');
    const summary = meter.summary(180_000);
    assert.equal(summary.minutes, 3);
    assert.equal(summary.sttSeconds, 60);
    assert.equal(summary.ttsSeconds, 30);
    assert.equal(tokensFromChars('abcd'), 1);
    assert.equal(tokensFromChars('abcde'), 2);
    assert.equal(summary.modelInputTokens, 1);
    assert.equal(summary.modelOutputTokens, 2);
    const raw = 0.002 + (0.7 / 120) + ((1 * 0.75) + (2 * 3.75)) / 1e6;
    assert.equal(summary.costUsd, Math.round(raw * 1e6) / 1e6);

    createCallMeter({ callSid: SID_A }).tts('Hello', PCM_BYTES_PER_SEC);
    createCallMeter({ callSid: SID_A }).finish({ bytesIn: PCM_BYTES_PER_SEC * 10, bytesSent: PCM_BYTES_PER_SEC * 10, keepalives: 1 });
    assert.equal(dailyMeterTotals().calls, 0);
    assert.equal(demoMeterTotals().calls, 1);
    assert.equal(demoMeterTotals().sttSecondsSent, 10);
    createCallMeter().finish({ bytesIn: PCM_BYTES_PER_SEC, bytesSent: PCM_BYTES_PER_SEC });
    assert.equal(dailyMeterTotals().calls, 1);
    assert.equal(demoMeterTotals().calls, 1);
  });

  it('refuses a new token at the daily cap and logs only a hashed IP and device', async () => {
    const store = createMemorySpendStore();
    const now = Date.parse('2026-10-31T08:00:00Z');
    const ledger = createDemoLedger({ store, env: spendEnv(), now: () => now });
    await ledger.ready();
    assert.equal(await ledger.record({ sessionId: SID_A, ...usage({ costUsd: 2, minutes: 85 }) }), true);
    assert.equal(ledger.blocked(), true);
    const lines = [];
    const calls = [];
    const guard = createDemoGuard({
      env: guardEnv(),
      now: () => now,
      spend: ledger,
      fetch: async (url) => {
        calls.push(String(url));
        return { json: async () => ({ success: true }) };
      },
      log: (line) => lines.push(line),
    });
    const out = await guard.decide(request());
    assert.equal(out.status, 503);
    assert.deepEqual(out.body, { reason: 'cap' });
    assert.equal(calls.length, 0);
    const logged = JSON.parse(lines.at(-1).slice('demo_token_reject '.length));
    assert.equal(logged.reason, 'cap');
    assert.equal(logged.ip_hash, IP_HASH);
    assert.equal(logged.device_hash, hashValue(SALT, DEVICE));
    assert.equal(logged.device_id, undefined);
    const text = lines.join('\n');
    assert.equal(text.includes(IP), false);
    assert.equal(text.includes(DEVICE), false);
    assert.equal(text.includes('audio'), false);
    assert.equal(text.includes('transcript'), false);
    const health = healthCounts(ledger.totals());
    assert.equal(health.capped, true);
    assert.equal(health.daySessions, 1);
    assert.equal(JSON.stringify(health).includes(SID_A), false);
    assert.equal(JSON.stringify(health).includes('device'), false);
  });

  it('rolls the daily cap at the EAT day boundary and keeps the month', async () => {
    const store = createMemorySpendStore();
    const env = spendEnv({ DEMO_MONTHLY_CAP_USD: '3' });
    const day1 = Date.parse('2026-10-30T20:30:00Z');
    const day2 = Date.parse('2026-10-30T21:30:00Z');
    const first = createDemoLedger({ store, env, now: () => day1 });
    await first.ready();
    await first.record({ sessionId: SID_A, ...usage({ costUsd: 2, minutes: 80 }) });
    assert.equal(first.blocked(), true);
    assert.equal(first.totals().day, '2026-10-30');

    const second = createDemoLedger({ store, env, now: () => day2 });
    await second.ready();
    assert.equal(second.totals().day, '2026-10-31');
    assert.equal(second.totals().dayUsd, 0);
    assert.equal(second.totals().monthUsd, 2);
    assert.equal(second.blocked(), false);
    await second.record({ sessionId: SID_B, ...usage({ costUsd: 1, minutes: 40 }) });
    assert.equal(second.totals().monthUsd, 3);
    assert.equal(second.blocked(), true);

    const november = Date.parse('2026-10-31T21:30:00Z');
    const third = createDemoLedger({ store, env, now: () => november });
    await third.ready();
    assert.equal(third.totals().month, '2026-11');
    assert.equal(third.totals().monthUsd, 0);
    assert.equal(third.blocked(), false);
  });

  it('keeps the cap after a restart when the store reloads the same rows', async () => {
    const store = createMemorySpendStore();
    const now = Date.parse('2026-10-31T08:00:00Z');
    const env = spendEnv();
    const first = createDemoLedger({ store, env, now: () => now });
    await first.ready();
    await first.record({ sessionId: SID_A, ...usage({ costUsd: 1.5, minutes: 60 }) });
    await first.record({ sessionId: SID_A, ...usage({ costUsd: 1.25, minutes: 50 }) });
    assert.equal(first.totals().dayUsd, 1.25);

    const restarted = createDemoLedger({ store, env, now: () => now });
    await restarted.ready();
    assert.equal(restarted.totals().dayUsd, 1.25);
    assert.equal(restarted.totals().monthUsd, 1.25);
    assert.equal(restarted.blocked(), false);
    await restarted.record({ sessionId: SID_B, ...usage({ costUsd: 0.75, minutes: 30 }) });
    assert.equal(restarted.blocked(), true);

    const ended = [];
    restarted.attach(SID_C, {
      costUsd: () => 0,
      minutes: () => 1,
      onCap: () => ended.push('cap'),
    });
    restarted.touch();
    assert.deepEqual(ended, ['cap']);
  });

  it('reloads numeric strings from the supabase store and ignores a failed load', async () => {
    const rows = new Map();
    const client = {
      from(table) {
        assert.equal(table, 'demo_spend');
        return {
          select() {
            return Promise.resolve({ data: [...rows.values()], error: null });
          },
          upsert(row) {
            const saved = { ...row };
            assert.equal(saved.ip_hash, undefined);
            assert.equal(saved.device_id, undefined);
            assert.equal(saved.device_hash, undefined);
            assert.equal(saved.audio, undefined);
            assert.equal(saved.text, undefined);
            rows.set(saved.session_id, { ...saved, cost_usd: String(saved.cost_usd) });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    const store = createSupabaseSpendStore(client);
    const now = Date.parse('2026-10-31T08:00:00Z');
    const env = spendEnv({ DEMO_MONTHLY_CAP_USD: '50' });
    const first = createDemoLedger({ store, env, now: () => now });
    await first.ready();
    assert.equal(await first.record({ sessionId: 'CA123', ...usage({ costUsd: 9 }) }), false);
    assert.equal(rows.size, 0);
    await first.record({ sessionId: SID_A, ...usage({ costUsd: 2, minutes: 90 }) });
    const restarted = createDemoLedger({ store, env, now: () => now });
    await restarted.ready();
    assert.equal(restarted.totals().dayUsd, 2);
    assert.equal(restarted.blocked(), true);

    const broken = createSupabaseSpendStore({
      from() {
        return {
          select: async () => ({ data: null, error: { message: 'relation demo_spend does not exist' } }),
          upsert: async () => ({ error: null }),
        };
      },
    });
    const failed = createDemoLedger({ store: broken, env, now: () => now });
    await failed.ready();
    assert.equal(failed.blocked(), false);
    assert.equal(failed.totals().dayUsd, 0);
  });

  it('ends a live session on cap or kill and speaks one polite line', async () => {
    for (const line of [CAP.en, CAP.sw, KILL.en, KILL.sw, GOODBYE.en, GOODBYE.sw]) {
      assert.equal(line.includes('—'), false, line);
      assert.equal(line.includes('–'), false, line);
      assert.equal(line.includes('!'), false, line);
    }
    const store = createMemorySpendStore();
    const now = Date.parse('2026-10-31T08:00:00Z');
    const ledger = createDemoLedger({ store, env: spendEnv(), now: () => now });
    await ledger.ready();
    await ledger.record({ sessionId: SID_A, ...usage({ costUsd: 2, minutes: 85 }) });
    const speech = fakeSpeech();
    const ws = fakeWs();
    const lines = [];
    let tick = null;
    const env = spendEnv();
    const session = createDemoSession({
      ws,
      claims: { tenant: 'demo_home', lang: 'sw', ip_hash: IP_HASH, device_id: DEVICE },
      codec: 'pcm16',
      env,
      origin: 'https://staging.example',
      ledger,
      now: () => now,
      setInterval(fn) { tick = fn; return 1; },
      clearInterval() { tick = null; },
      log: (line) => lines.push(line),
      loadProfile: async () => null,
      createStt: speech.createStt,
      createTts: speech.createTts,
      brain: async () => ({ text: 'ok', lang: 'sw' }),
    });
    await session.start();
    assert.equal(tick, null);
    assert.ok(speech.spoken.includes(CAP.sw));
    const ended = ws.jsons().find((item) => item.type === 'end');
    assert.equal(ended.reason, 'cap');
    const endLog = lines.find((line) => line.startsWith('demo_session_end '));
    const logged = JSON.parse(endLog.slice('demo_session_end '.length));
    assert.equal(logged.reason, 'cap');
    assert.equal(logged.device_hash, hashValue(SALT, DEVICE));
    assert.equal(logged.device_id, undefined);
    assert.equal(endLog.includes(DEVICE), false);
    assert.equal(endLog.includes(IP), false);
    assert.equal(endLog.includes('Amina'), false);
    assert.equal(endLog.includes('audio'), false);

    const liveEnv = spendEnv();
    const liveLedger = createDemoLedger({
      store: createMemorySpendStore(),
      env: liveEnv,
      now: () => now,
    });
    await liveLedger.ready();
    const liveSpeech = fakeSpeech();
    const liveWs = fakeWs();
    let liveTick = null;
    const live = createDemoSession({
      ws: liveWs,
      claims: { tenant: 'demo_shop', lang: 'en', ip_hash: IP_HASH, device_id: DEVICE },
      codec: 'pcm16',
      env: liveEnv,
      ledger: liveLedger,
      now: () => now,
      setInterval(fn) { liveTick = fn; return 1; },
      clearInterval() { liveTick = null; },
      log() {},
      loadProfile: async () => null,
      createStt: liveSpeech.createStt,
      createTts: liveSpeech.createTts,
    });
    await live.start();
    assert.equal(typeof liveTick, 'function');
    liveEnv.DEMO_ENABLED = 'off';
    liveTick();
    await flush();
    assert.ok(liveSpeech.spoken.includes(KILL.en));
    assert.equal(liveWs.jsons().find((item) => item.type === 'end').reason, 'kill');
    assert.equal(liveTick, null);
  });
});
