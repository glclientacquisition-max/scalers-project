// These tests pin the feature itself; the flags-off suite run covers the rest.
process.env.VOICE_SPOKEN_ADDRESS = 'on';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { speakAddresses, segmentLabel, normaliseTerms } = require('../src/speech/spokenAddress');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { cutNoAiSlop } = require('../src/speech/noAiSlop');
const { createSpokenStreamBuffer, splitSpeakableChunks } = require('../src/speech/spokenStreamBuffer');

const TERMS = ['Aris Kenya', 'Aris'];

describe('spoken address normaliser', () => {
  it('splits a glued domain on tenant words and says dot', () => {
    assert.equal(
      speakAddresses('Visit arisstationaries.co.ke.', { terms: TERMS, enabled: true }),
      'Visit aris stationaries dot co dot ke.'
    );
  });

  it('strips scheme and www and trailing slash', () => {
    assert.equal(
      speakAddresses('See https://www.arisstationaries.co.ke/ today', { terms: TERMS, enabled: true }),
      'See aris stationaries dot co dot ke today'
    );
  });

  it('emails use at, paths use slash, hyphens use dash', () => {
    assert.equal(
      speakAddresses('Write to info@arisstationaries.co.ke', { terms: TERMS, enabled: true }),
      'Write to info at aris stationaries dot co dot ke'
    );
    assert.equal(
      speakAddresses('Go to my-shop.com/pens', { terms: [], enabled: true }),
      'Go to my dash shop dot com slash pens'
    );
  });

  it('Kiswahili uses the same dot/at words', () => {
    const r = prepareForTts('Tembelea tovuti yetu arisstationaries.co.ke.', {
      callLanguage: 'sw',
      addressTerms: TERMS,
    });
    assert.match(r.text, /aris stationaries dot co dot ke/);
  });

  it('leaves decimals, money, sentence joins, and abbreviations alone', () => {
    for (const text of ['It is 3.5 km.', 'KSh 1,500.50 only.', 'Done.Thanks', 'e.g. pens']) {
      assert.equal(speakAddresses(text, { terms: TERMS, enabled: true }), text);
    }
  });

  it('segmentation only splits on known words', () => {
    assert.deepEqual(segmentLabel('arisstationaries', normaliseTerms(TERMS)), ['aris', 'stationaries']);
    assert.deepEqual(segmentLabel('unknownshop', normaliseTerms(TERMS)), ['unknownshop']);
    assert.deepEqual(normaliseTerms([{ match: '\\bfoo\\b', say: 'x' }, { match: 'Chapter One', say: 'y' }]), ['chapter', 'one']);
  });

  it('off switch', () => {
    assert.equal(speakAddresses('arisstationaries.co.ke', { terms: TERMS, enabled: false }), 'arisstationaries.co.ke');
  });
});

describe('no_ai_slop and the stream chunker keep addresses whole', () => {
  it('no_ai_slop does not split a domain into sentences', () => {
    const out = cutNoAiSlop('You can shop online at arisstationaries.co.ke. Anything else?');
    assert.match(out, /arisstationaries\.co\.ke\. Anything else\?/);
  });

  it('streamed deltas that end inside an address wait for the next delta', () => {
    const buf = createSpokenStreamBuffer();
    assert.deepEqual(buf.push('You can visit our website at arisstationaries.'), []);
    assert.deepEqual(buf.push('co.ke. Anything'), ['You can visit our website at arisstationaries.co.ke.']);
    assert.deepEqual(buf.finish(), ['Anything']);
  });

  it('ordinary sentence ends still flush at once', () => {
    const buf = createSpokenStreamBuffer();
    assert.deepEqual(buf.push('Thanks, Jane.'), ['Thanks, Jane.']);
    assert.deepEqual(splitSpeakableChunks('We are open today.', { final: false }).chunks, ['We are open today.']);
  });
});
