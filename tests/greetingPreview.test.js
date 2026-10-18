'use strict';

// POST /api/tts/preview greeting=1 (src/speech/greetingPreview.js): the Desk
// Test preview speaks the exact greeting a live call would. No network.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  wantsGreetingPreview,
  previewTenantId,
  synthesizeGreetingPreview,
} = require('../src/speech/greetingPreview');
const { greetingInputs } = require('../src/speech/greetingWarm');
const { generateDynamicGreeting } = require('../src/conversation/dynamicSpeech');
const { lookupGreetingPcm, putGreetingPcm, resetGreetingPcmCache } = require('../src/speech/greetingPcmCache');

const ESGA_ID = 'c81b3480-0cc5-4224-b0e7-24c641d78db2';
// 16 Oct 07:52 EAT, the owner-review call time: morning daypart.
const NOW = new Date('2026-10-16T04:52:00Z');

function esgaProfile() {
  return {
    id: ESGA_ID,
    businessName: 'Esga Stationery',
    spokenName: 'Esga',
    agentName: 'Lucy',
    greetingInvite: 'Nikusaidie vipi',
    afterHoursMode: 'serve',
    hoursSchedule: null,
    sonioxVoiceId: null,
    ttsLexicon: [
      { match: 'esga', say: 'E-SGA', langs: ['en', 'sw', 'sheng'], priority: 200 },
      { match: 'esga\\s+stationery', say: 'Esga Stationery', langs: ['en', 'sw', 'sheng'], priority: 200 },
      { match: 'lucy', say: 'Lucy', langs: ['en', 'sw', 'sheng'], priority: 200 },
    ],
  };
}

function fakeSessionFactory() {
  const made = [];
  const createSession = ({ voiceId }) => {
    const s = {
      voiceId,
      pushed: [],
      begin: null,
      closed: false,
      ready: Promise.resolve(),
      async beginSpeak(opts) {
        s.begin = opts;
        return {
          pushText: (t) => s.pushed.push(t),
          end: async () => ({ pcm: Buffer.alloc(3200, 1) }),
        };
      },
      close() {
        s.closed = true;
      },
    };
    made.push(s);
    return s;
  };
  return { createSession, made };
}

beforeEach(() => {
  if (typeof resetGreetingPcmCache === 'function') resetGreetingPcmCache();
});

describe('greeting=1 request parsing', () => {
  it('only greeting=1/true/on/yes turns it on (absent = old text preview path)', () => {
    assert.equal(wantsGreetingPreview({ query: {}, body: { text: 'Hi' } }), false);
    assert.equal(wantsGreetingPreview({ query: { greeting: '0' }, body: {} }), false);
    assert.equal(wantsGreetingPreview({ query: { greeting: '1' }, body: {} }), true);
    assert.equal(wantsGreetingPreview({ query: {}, body: { greeting: true } }), true);
  });

  it('reads tenant_id from body or query', () => {
    assert.equal(previewTenantId({ body: { tenant_id: ' abc ' } }), 'abc');
    assert.equal(previewTenantId({ body: {}, query: { tenant_id: 'q1' } }), 'q1');
    assert.equal(previewTenantId({}), '');
  });
});

describe('synthesizeGreetingPreview', () => {
  it('Esga lexicon "E-SGA" entry: spoken text says "Esga", same as the live call', async () => {
    const { createSession } = fakeSessionFactory();
    const r = await synthesizeGreetingPreview({
      tenantId: ESGA_ID,
      getProfile: async () => esgaProfile(),
      createSession,
      now: NOW,
    });
    assert.match(r.spokenText, /\bEsga\b/);
    assert.doesNotMatch(r.spokenText, /E-SGA/);
    assert.match(r.text, /^Good morning, Esga, this is Lucy\./);
    assert.equal(r.source, 'tts');
  });

  it('uses the live greeting builder and the live lookup (same text, same prepared text)', async () => {
    const profile = esgaProfile();
    const liveText = await generateDynamicGreeting(greetingInputs(profile, { now: NOW }));
    const live = lookupGreetingPcm({
      voiceId: profile.sonioxVoiceId,
      text: liveText,
      extraLexicon: profile.ttsLexicon,
      businessName: profile.businessName,
      agentName: profile.agentName,
    });
    const { createSession, made } = fakeSessionFactory();
    const r = await synthesizeGreetingPreview({ tenantId: ESGA_ID, getProfile: async () => profile, createSession, now: NOW });
    assert.equal(r.text, liveText);
    assert.equal(r.spokenText, live.prepared.text);
    assert.equal(r.language, live.prepared.language);
    assert.equal(made[0].begin.alreadyPrepared, true);
    assert.equal(made[0].begin.speedScale, 1);
    assert.equal(made[0].pushed.join(' ').replace(/\s+/g, ' ').trim(), live.prepared.text.replace(/\s+/g, ' ').trim());
    assert.equal(made[0].closed, true);
  });

  it('cache hit returns the warmed PCM with source=cache and opens no TTS session', async () => {
    const profile = esgaProfile();
    const liveText = await generateDynamicGreeting(greetingInputs(profile, { now: NOW }));
    const found = lookupGreetingPcm({
      voiceId: null,
      text: liveText,
      extraLexicon: profile.ttsLexicon,
      businessName: profile.businessName,
      agentName: profile.agentName,
    });
    const pcm = Buffer.alloc(1600, 7);
    putGreetingPcm(found.key, pcm, { tenantId: ESGA_ID });
    const { createSession, made } = fakeSessionFactory();
    const r = await synthesizeGreetingPreview({ tenantId: ESGA_ID, getProfile: async () => profile, createSession, now: NOW });
    assert.equal(r.source, 'cache');
    assert.deepEqual(r.pcm, pcm);
    assert.equal(made.length, 0);
    assert.ok(r.wav.length > 44);
    assert.equal(r.wav.subarray(0, 4).toString('ascii'), 'RIFF');
  });

  it('a cache miss does not write the greeting cache (warmer owns it)', async () => {
    const profile = esgaProfile();
    const { createSession } = fakeSessionFactory();
    await synthesizeGreetingPreview({ tenantId: ESGA_ID, getProfile: async () => profile, createSession, now: NOW });
    const again = fakeSessionFactory();
    const r = await synthesizeGreetingPreview({ tenantId: ESGA_ID, getProfile: async () => profile, createSession: again.createSession, now: NOW });
    assert.equal(r.source, 'tts');
    assert.equal(again.made.length, 1);
  });

  it('missing tenant_id is 400 and never falls back to a default tenant', async () => {
    let called = false;
    await assert.rejects(
      synthesizeGreetingPreview({ tenantId: '', getProfile: async () => { called = true; return esgaProfile(); }, createSession: () => null }),
      (err) => err.status === 400
    );
    await assert.rejects(
      synthesizeGreetingPreview({ tenantId: 'x; drop', getProfile: async () => esgaProfile(), createSession: () => null }),
      (err) => err.status === 400
    );
    assert.equal(called, false);
  });

  it('unknown tenant (default profile) is 404', async () => {
    await assert.rejects(
      synthesizeGreetingPreview({
        tenantId: 'nope',
        getProfile: async () => ({ id: 'nope', businessName: 'the business' }),
        createSession: () => null,
      }),
      (err) => err.status === 404
    );
  });

  it('empty TTS audio is 502 and the session is closed', async () => {
    let closed = false;
    const createSession = () => ({
      ready: Promise.resolve(),
      beginSpeak: async () => ({ pushText() {}, end: async () => ({ pcm: Buffer.alloc(0) }) }),
      close() {
        closed = true;
      },
    });
    await assert.rejects(
      synthesizeGreetingPreview({ tenantId: ESGA_ID, getProfile: async () => esgaProfile(), createSession, now: NOW }),
      (err) => err.status === 502
    );
    assert.equal(closed, true);
  });
});
