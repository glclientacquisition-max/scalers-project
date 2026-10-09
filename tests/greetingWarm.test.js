const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  greetingInputs,
  warmInstants,
  createGreetingWarmer,
  greetingWarmEnabled,
} = require('../src/speech/greetingWarm');
const { generateDynamicGreeting } = require('../src/conversation/dynamicSpeech');
const {
  lookupGreetingPcm,
  putGreetingPcm,
  resetGreetingPcmCache,
  greetingPcmCacheSize,
  greetingPcmCacheBytes,
  invalidateTenantGreetings,
  greetingPcmKey,
} = require('../src/speech/greetingPcmCache');

const ARIS = {
  id: 'tenant-aris',
  businessName: 'Aris Kenya',
  spokenName: 'Aris',
  agentName: 'Lynn',
  afterHoursMode: 'serve',
  hoursSchedule: null,
  ttsLexicon: [],
  sonioxVoiceId: null,
};

function fakeSessionFactory(counter) {
  return () => ({
    ready: Promise.resolve(),
    beginSpeak: async () => {
      const pieces = [];
      return {
        pushText: (t) => {
          pieces.push(t);
          return { pushed: true };
        },
        end: async () => {
          counter.renders += 1;
          return { pcm: Buffer.alloc(3200 * pieces.length), cancelled: false };
        },
      };
    },
    close: () => {},
  });
}

describe('greeting PCM cache bounds', () => {
  beforeEach(() => resetGreetingPcmCache());

  it('key carries voice settings and a hash of the spoken text', () => {
    const k = greetingPcmKey({ voiceId: null, language: 'en', spokenText: 'Hi, this is Lynn.', speed: 1 });
    assert.match(k, /\|en\|1\|[0-9a-f]{32}$/);
    assert.doesNotMatch(k, /Lynn/);
  });

  it('evicts by total bytes', () => {
    const prev = process.env.VOICE_GREETING_CACHE_MAX_BYTES;
    process.env.VOICE_GREETING_CACHE_MAX_BYTES = String(10000);
    try {
      putGreetingPcm('a', Buffer.alloc(4000));
      putGreetingPcm('b', Buffer.alloc(4000));
      putGreetingPcm('c', Buffer.alloc(4000));
      assert.ok(greetingPcmCacheBytes() <= 10000);
      assert.equal(greetingPcmCacheSize(), 2);
      assert.equal(putGreetingPcm('huge', Buffer.alloc(20000)), null, 'one clip over budget is not stored');
    } finally {
      if (prev == null) delete process.env.VOICE_GREETING_CACHE_MAX_BYTES;
      else process.env.VOICE_GREETING_CACHE_MAX_BYTES = prev;
    }
  });

  it('invalidates a tenant except the keys it keeps', () => {
    putGreetingPcm('old', Buffer.alloc(100), { tenantId: 't' });
    putGreetingPcm('new', Buffer.alloc(100), { tenantId: 't' });
    putGreetingPcm('other', Buffer.alloc(100), { tenantId: 'u' });
    assert.equal(invalidateTenantGreetings('t', { keep: ['new'] }), 1);
    assert.equal(greetingPcmCacheSize(), 2);
    assert.equal(greetingPcmCacheBytes(), 200);
  });
});

describe('greeting warmer', () => {
  beforeEach(() => resetGreetingPcmCache());

  it('renders the exact line a live call speaks now, so the call hits the cache', async () => {
    const now = new Date('2026-10-09T17:18:22Z'); // 20:18 EAT, evening
    const counter = { renders: 0 };
    const warmer = createGreetingWarmer({
      listTenantIds: async () => [ARIS.id],
      getProfile: async () => ARIS,
      createSession: fakeSessionFactory(counter),
      now: () => now,
    });
    const r = await warmer.warmTenant(ARIS.id);
    assert.equal(r.rendered, 1);
    // Same inputs as server.js greeting block.
    const line = await generateDynamicGreeting(greetingInputs(ARIS, { now }));
    assert.match(line, /Good evening, Aris, this is Lynn\./);
    const hit = lookupGreetingPcm({
      voiceId: ARIS.sonioxVoiceId,
      text: line,
      extraLexicon: ARIS.ttsLexicon,
      businessName: ARIS.businessName,
      agentName: ARIS.agentName,
    });
    assert.ok(hit.pcm, 'live lookup hits the warmed clip');
    // A second sweep renders nothing new.
    assert.equal((await warmer.warmTenant(ARIS.id)).rendered, 0);
    assert.equal(counter.renders, 1);
  });

  it('an Identity edit re-renders and drops the old clip', async () => {
    const now = new Date('2026-10-09T09:00:00Z');
    let profile = { ...ARIS };
    const counter = { renders: 0 };
    const warmer = createGreetingWarmer({
      listTenantIds: async () => [ARIS.id],
      getProfile: async () => profile,
      createSession: fakeSessionFactory(counter),
      now: () => now,
    });
    await warmer.warmTenant(ARIS.id);
    profile = { ...ARIS, agentName: 'Wanjiru' };
    const r = await warmer.warmTenant(ARIS.id);
    assert.equal(r.rendered, 1);
    assert.equal(r.dropped, 1);
    assert.equal(greetingPcmCacheSize(), 1);
  });

  it('pre-renders the next daypart near the boundary', () => {
    assert.equal(warmInstants(new Date('2026-10-09T13:50:00Z')).length, 2); // 16:50 EAT
    assert.equal(warmInstants(new Date('2026-10-09T10:00:00Z')).length, 1); // 13:00 EAT
  });

  it('skips the default shop name and survives a render failure', async () => {
    const warmer = createGreetingWarmer({
      listTenantIds: async () => ['a', 'b'],
      getProfile: async (id) => (id === 'a' ? { ...ARIS, businessName: '' } : ARIS),
      createSession: () => ({
        ready: Promise.reject(new Error('soniox down')),
        close: () => {},
      }),
      now: () => new Date('2026-10-09T09:00:00Z'),
    });
    const results = await warmer.warmAll();
    assert.equal(results.length, 2);
    assert.equal(greetingPcmCacheSize(), 0);
  });

  it('flag follows the cache flag', () => {
    const prev = process.env.VOICE_GREETING_WARM;
    process.env.VOICE_GREETING_WARM = 'off';
    try {
      assert.equal(greetingWarmEnabled(), false);
    } finally {
      if (prev == null) delete process.env.VOICE_GREETING_WARM;
      else process.env.VOICE_GREETING_WARM = prev;
    }
  });
});
