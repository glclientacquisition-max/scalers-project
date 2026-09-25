const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
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
