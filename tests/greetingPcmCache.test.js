const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  greetingPcmKey,
  lookupGreetingPcm,
  putGreetingPcm,
  resetGreetingPcmCache,
  greetingPcmCacheSize,
} = require('../src/speech/greetingPcmCache');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { mergeIdentityLexicon } = require('../src/speech/pronunciationLexicon');

describe('greeting PCM cache', () => {
  beforeEach(() => {
    resetGreetingPcmCache();
  });

  it('returns a cache miss then a hit for the same spoken greeting', () => {
    const text = 'ChapterOne Bookstore, this is Aisha. How can I help?';
    const miss = lookupGreetingPcm({
      text,
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
    });
    assert.equal(miss.pcm, null);
    assert.ok(miss.prepared.text);
    putGreetingPcm(miss.key, Buffer.alloc(4000));
    const hit = lookupGreetingPcm({
      text,
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
    });
    assert.ok(hit.pcm);
    assert.equal(hit.pcm.length, 4000);
    assert.equal(greetingPcmCacheSize(), 1);
  });

  it('keys greeting PCM by profile speed so a pace change cannot replay a stale clip', () => {
    const a = greetingPcmKey({
      voiceId: null,
      language: 'en',
      spokenText: 'Hi, this is Aisha.',
      speed: 1,
    });
    const b = greetingPcmKey({
      voiceId: null,
      language: 'en',
      spokenText: 'Hi, this is Aisha.',
      speed: 1.06,
    });
    assert.notEqual(a, b);
    assert.match(a, /\|1\|/);
    assert.match(b, /\|1\.06\|/);
  });

  it('stores greeting PCM without even-out so playback matches live gain', () => {
    const quiet = Buffer.alloc(3200);
    quiet.writeInt16LE(800, 0);
    const miss = lookupGreetingPcm({
      text: 'Hello from Aisha.',
      businessName: 'Shop',
      agentName: 'Aisha',
    });
    const stored = putGreetingPcm(miss.key, quiet);
    assert.equal(stored.readInt16LE(0), 800);
  });
});

describe('Kenya mouth on first greeting clip', () => {
  it('applies shop and agent lexicon before first PCM', () => {
    const extras = mergeIdentityLexicon([], {
      businessName: 'ChapterOne Bookstore',
      agentName: 'Aisha',
    });
    const prepared = prepareForTts(
      'ChapterOne Bookstore, this is Aisha. How can I help?',
      { extraLexicon: extras }
    );
    assert.match(prepared.text, /Chapter One Bookstore/i);
    assert.match(prepared.text, /Eye-sha/i);
    assert.doesNotMatch(prepared.text, /You can speak in English or Kiswahili/i);
  });
});
