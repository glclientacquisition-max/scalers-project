'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createDemoCodec,
  PCM16_FRAME_BYTES,
  PCM8_FRAME_BYTES,
  SAMPLE_RATE,
} = require('../src/demo/codec');

function tone(value, bytes) {
  const pcm = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 2) pcm.writeInt16LE(value, i);
  return pcm;
}

describe('demo codec', () => {
  it('passes 16 kHz PCM16 through unchanged', () => {
    const codec = createDemoCodec('pcm16');
    const pcm = tone(1000, PCM16_FRAME_BYTES);
    const frames = codec.encode(pcm);
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0], pcm);
    assert.deepEqual(codec.decode(pcm), pcm);
    codec.close();
  });

  it('upsamples PCM8 to 16 kHz s16le and downsamples on the way out', () => {
    const codec = createDemoCodec('pcm8');
    const pcm8 = tone(8000, PCM8_FRAME_BYTES);
    const pcm16 = codec.decode(pcm8);
    assert.equal(pcm16.length, PCM16_FRAME_BYTES);
    assert.equal(SAMPLE_RATE, 16000);
    const back = codec.encode(pcm16);
    assert.equal(back.length, 1);
    assert.equal(back[0].length, PCM8_FRAME_BYTES);
    codec.close();
  });

  it('round-trips Opus to 16 kHz s16le', () => {
    const enc = createDemoCodec('opus');
    const dec = createDemoCodec('opus');
    const pcm = tone(8000, PCM16_FRAME_BYTES);
    const frames = enc.encode(pcm);
    assert.equal(frames.length, 1);
    assert.ok(frames[0].length > 0);
    assert.ok(frames[0].length < pcm.length);
    const back = dec.decode(frames[0]);
    assert.equal(back.length, PCM16_FRAME_BYTES);
    let energy = 0;
    for (let i = 0; i < back.length; i += 2) energy += Math.abs(back.readInt16LE(i));
    assert.ok(energy > 0);
    enc.close();
    dec.close();
  });

  it('does not import a telephony client', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src/demo/codec.js'), 'utf8');
    assert.equal(text.includes('sautikit'), false);
    assert.equal(text.includes('applyPcmGain'), false);
    assert.match(text, /opusscript/);
  });
});
