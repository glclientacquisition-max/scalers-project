const { describe, it } = require('node:test');
const assert = require('assert');
const { pcmToWav } = require('../src/speech/wavPack');
const {
  pcmDurationMs,
  resampleS16le,
  wavBytesTo16kPcm,
  applyPcmGain,
  evenOutPcmS16le,
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

  it('applyPcmGain scales samples and clips to int16', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-1000, 2);
    const out = applyPcmGain(pcm, 1.22);
    assert.equal(out.readInt16LE(0), 1220);
    assert.equal(out.readInt16LE(2), -1220);
    assert.notEqual(out, pcm);
  });

  it('applyPcmGain is a no-op near gain 1', () => {
    const pcm = Buffer.alloc(2);
    pcm.writeInt16LE(400, 0);
    assert.equal(applyPcmGain(pcm, 1), pcm);
  });

  it('evenOutPcmS16le raises a quiet clip, not a loud one', () => {
    const quiet = Buffer.alloc(8);
    quiet.writeInt16LE(1000, 0);
    quiet.writeInt16LE(-800, 2);
    quiet.writeInt16LE(900, 4);
    quiet.writeInt16LE(-700, 6);
    const raised = evenOutPcmS16le(quiet, { targetPeak: 20000, maxGain: 1.8 });
    assert.ok(Math.abs(raised.readInt16LE(0)) > Math.abs(quiet.readInt16LE(0)));

    const loud = Buffer.alloc(8);
    loud.writeInt16LE(22000, 0);
    loud.writeInt16LE(-21000, 2);
    loud.writeInt16LE(18000, 4);
    loud.writeInt16LE(-19000, 6);
    assert.equal(evenOutPcmS16le(loud, { targetPeak: 20000, maxGain: 1.8 }), loud);
  });
});
