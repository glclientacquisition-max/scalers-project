// WAV pack helper for desk preview playback.
// Run: node --test tests/wavPack.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const {
  pcmToWav,
  pcmToBrowserWav,
  BROWSER_PREVIEW_RATE,
} = require('../src/speech/wavPack');

describe('pcmToWav', () => {
  it('wraps mono s16le PCM in a valid RIFF header', () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-500, 2);
    const wav = pcmToWav(pcm, 16000);
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.length, 44 + pcm.length);
  });
});

describe('pcmToBrowserWav', () => {
  it('emits 44.1 kHz PCM WAV for browser audio/wav playback', () => {
    const pcm = Buffer.alloc(3200);
    for (let i = 0; i < 1600; i++) pcm.writeInt16LE(i % 200, i * 2);
    const wav = pcmToBrowserWav(pcm, 16000);
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM format');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), BROWSER_PREVIEW_RATE);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal((wav.length - 44) % 2, 0);
    assert.ok(wav.length > 44);
  });
});
