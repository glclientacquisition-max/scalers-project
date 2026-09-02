const { describe, it } = require('node:test');
const assert = require('assert');
const { pcmToWav } = require('../src/speech/wavPack');
const {
  pcmDurationMs,
  resampleS16le,
  wavBytesTo16kPcm,
} = require('../src/speech/pcmUtil');

describe('pcmUtil', () => {
  it('reports duration for 16 kHz mono s16le', () => {
    const oneSecond = Buffer.alloc(16000 * 2);
    assert.equal(pcmDurationMs(oneSecond, 16000), 1000);
  });

  it('resamples 24 kHz down to 16 kHz', () => {
    const inSamples = 24000;
    const src = Buffer.alloc(inSamples * 2);
    for (let i = 0; i < inSamples; i++) src.writeInt16LE(i % 200, i * 2);
    const out = resampleS16le(src, 24000, 16000);
    assert.equal(out.length / 2, 16000);
  });

  it('strips a WAV header produced by pcmToWav', () => {
    const pcm = Buffer.alloc(320);
    pcm.writeInt16LE(1234, 0);
    const wav = pcmToWav(pcm, 16000);
    const extracted = wavBytesTo16kPcm(wav);
    assert.equal(extracted.length, pcm.length);
    assert.equal(extracted.readInt16LE(0), 1234);
  });
});
