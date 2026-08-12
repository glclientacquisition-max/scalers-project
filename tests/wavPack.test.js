// WAV pack helper for desk preview playback.
// Run: node --test tests/wavPack.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const { pcmToWav } = require('../src/speech/wavPack');

describe('pcmToWav', () => {
  it('wraps mono s16le PCM in a valid RIFF header', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-500, 2);
    const wav = pcmToWav(pcm, 16000);
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.length, 44 + pcm.length);
  });
});
