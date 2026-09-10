// Run: node tests/fillerPcmCache.test.js

const assert = require('assert');
const {
  isFillerCacheEnabled,
  fillerPcmKey,
  lookupFillerPcm,
  getFillerPcm,
  putFillerPcm,
  isCancelableTtsStreamId,
  newCachedFillerStreamId,
  CACHED_FILLER_STREAM_PREFIX,
  MAX_ENTRIES,
  commonAckPhrases,
  warmFillerAckPcm,
  resetFillerPcmCache,
  fillerPcmCacheSize,
} = require('../src/speech/fillerPcmCache');

async function main() {
  resetFillerPcmCache();

  assert.strictEqual(isCancelableTtsStreamId('tts-abc'), true);
  assert.strictEqual(isCancelableTtsStreamId('cached-filler-abc'), false);
  assert.strictEqual(isCancelableTtsStreamId(''), false);
  assert.match(newCachedFillerStreamId(), new RegExp(`^${CACHED_FILLER_STREAM_PREFIX}`));

  const keyA = fillerPcmKey({
    voiceId: null,
    language: 'en',
    spokenText: 'Mm-hmm.',
    speed: 1.02,
  });
  const keyB = fillerPcmKey({
    voiceId: null,
    language: 'sw',
    spokenText: 'Mm-hmm.',
    speed: 1.02,
  });
  assert.notStrictEqual(keyA, keyB);

  const pcm = Buffer.from([1, 2, 3, 4]);
  assert.ok(putFillerPcm(keyA, pcm));
  assert.deepStrictEqual([...getFillerPcm(keyA)], [1, 2, 3, 4]);

  resetFillerPcmCache();
  const found = lookupFillerPcm({ text: 'Mm-hmm.', callLanguage: 'en' });
  assert.ok(found.key);
  assert.strictEqual(found.pcm, null);
  putFillerPcm(found.key, Buffer.alloc(8, 7));
  assert.strictEqual(lookupFillerPcm({ text: 'Mm-hmm.', callLanguage: 'en' }).pcm.length, 8);

  resetFillerPcmCache();
  for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
    putFillerPcm(`k-${i}`, Buffer.from([i]));
  }
  assert.strictEqual(fillerPcmCacheSize(), MAX_ENTRIES);
  assert.strictEqual(getFillerPcm('k-0'), null);
  assert.ok(getFillerPcm(`k-${MAX_ENTRIES + 4}`));

  resetFillerPcmCache();
  const quiet = Buffer.alloc(3200);
  quiet.writeInt16LE(800, 0);
  const stored = putFillerPcm('even-out', quiet);
  assert.ok(Math.abs(stored.readInt16LE(0)) > 800);

  const phrases = commonAckPhrases();
  assert.ok(phrases.includes('Mm-hmm.'));
  assert.ok(phrases.includes('Alright.'));
  assert.ok(phrases.includes('Sawa.'));

  const prev = process.env.VOICE_FILLER_CACHE;
  process.env.VOICE_FILLER_CACHE = 'off';
  assert.strictEqual(isFillerCacheEnabled(), false);
  process.env.VOICE_FILLER_CACHE = prev || 'on';
  assert.strictEqual(isFillerCacheEnabled(), true);

  let beginCalls = 0;
  const fakeTts = {
    async beginSpeak() {
      beginCalls += 1;
      return {
        pushText() {
          return { pushed: true };
        },
        cancel() {},
        async end() {
          return { cancelled: false, pcm: Buffer.alloc(4, 9) };
        },
      };
    },
  };
  resetFillerPcmCache();
  const warmed = await warmFillerAckPcm({ tts: fakeTts });
  assert.ok(warmed.warmed >= 1);
  assert.ok(beginCalls >= 1);
  assert.ok(fillerPcmCacheSize() >= 1);

  const secondBegin = beginCalls;
  const warmedAgain = await warmFillerAckPcm({ tts: fakeTts });
  assert.strictEqual(warmedAgain.warmed, 0);
  assert.strictEqual(beginCalls, secondBegin);

  const aborted = await warmFillerAckPcm({
    tts: fakeTts,
    shouldAbort: () => true,
  });
  resetFillerPcmCache();
  const abortedFresh = await warmFillerAckPcm({
    tts: fakeTts,
    shouldAbort: () => true,
  });
  assert.strictEqual(abortedFresh.warmed, 0);
  assert.strictEqual(aborted.warmed, 0);

  console.log('fillerPcmCache ok.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
