'use strict';

// Browser demo wire audio.
//
// Primary (spec): Opus, 16 kHz, mono, 20 ms (320 samples). Library is
// opusscript, a pure-JS libopus build. No native compile, no telephony
// dependency. Bitrate is set to 24 kbps so a two-way session stays near
// the spec's 0.36 MB/min estimate.
//
// Fallback (spec): PCM16 little-endian at 8 kHz (`codec=pcm8`), upsampled
// to 16 kHz before STT and downsampled on the way out.
//
// Also accepted: PCM16 at 16 kHz (`codec=pcm16`), 640 bytes per 20 ms.
// The frozen contract names pcm8 as the fallback. pcm16 is here because
// some browsers' WebCodecs Opus encoder only accepts 48 kHz, and this
// server decodes 16 kHz Opus only. See docs/demo-contract.md.
//
// Phone gain is not applied here.

const { resampleS16le } = require('../speech/pcmUtil');

const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
const PCM16_FRAME_BYTES = FRAME_SAMPLES * 2;
const PCM8_RATE = 8000;
const PCM8_FRAME_BYTES = (PCM8_RATE * FRAME_MS / 1000) * 2;
const OPUS_BITRATE = 24000;

function evenPcm(buf) {
  const src = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (src.length < 2) return Buffer.alloc(0);
  return src.length % 2 === 0 ? src : src.subarray(0, src.length - 1);
}

function takeFrames(pcm, frameBytes) {
  const src = evenPcm(pcm);
  const frames = [];
  let offset = 0;
  while (offset + frameBytes <= src.length) {
    frames.push(Buffer.from(src.subarray(offset, offset + frameBytes)));
    offset += frameBytes;
  }
  return { frames, rest: src.subarray(offset) };
}

function pcm16Codec() {
  let pending = Buffer.alloc(0);
  return {
    kind: 'pcm16',
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    pcmFrameBytes: PCM16_FRAME_BYTES,
    decode(packet) {
      return evenPcm(packet);
    },
    encode(pcm) {
      const src = pending.length ? Buffer.concat([pending, evenPcm(pcm)]) : evenPcm(pcm);
      const split = takeFrames(src, PCM16_FRAME_BYTES);
      pending = Buffer.from(split.rest);
      return split.frames;
    },
    close() {
      pending = Buffer.alloc(0);
    },
  };
}

function pcm8Codec() {
  let pending = Buffer.alloc(0);
  return {
    kind: 'pcm8',
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    pcmFrameBytes: PCM16_FRAME_BYTES,
    decode(packet) {
      const pcm8 = evenPcm(packet);
      if (pcm8.length < 2) return Buffer.alloc(0);
      return resampleS16le(pcm8, PCM8_RATE, SAMPLE_RATE);
    },
    encode(pcm) {
      const src = pending.length ? Buffer.concat([pending, evenPcm(pcm)]) : evenPcm(pcm);
      const split = takeFrames(src, PCM16_FRAME_BYTES);
      pending = Buffer.from(split.rest);
      return split.frames.map((frame) => resampleS16le(frame, SAMPLE_RATE, PCM8_RATE));
    },
    close() {
      pending = Buffer.alloc(0);
    },
  };
}

function opusCodec() {
  const OpusScript = require('opusscript');
  const encoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
  const decoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
  try {
    encoder.setBitrate(OPUS_BITRATE);
  } catch {
    /* library still encodes if the ctl is refused */
  }
  let pending = Buffer.alloc(0);
  let closed = false;
  return {
    kind: 'opus',
    sampleRate: SAMPLE_RATE,
    frameMs: FRAME_MS,
    pcmFrameBytes: PCM16_FRAME_BYTES,
    decode(packet) {
      if (closed || !packet || !packet.length) return Buffer.alloc(0);
      const pcm = decoder.decode(Buffer.from(packet));
      return evenPcm(pcm);
    },
    encode(pcm) {
      if (closed) return [];
      const src = pending.length ? Buffer.concat([pending, evenPcm(pcm)]) : evenPcm(pcm);
      const frames = [];
      let offset = 0;
      while (offset + PCM16_FRAME_BYTES <= src.length) {
        const frame = src.subarray(offset, offset + PCM16_FRAME_BYTES);
        frames.push(Buffer.from(encoder.encode(Buffer.from(frame), FRAME_SAMPLES)));
        offset += PCM16_FRAME_BYTES;
      }
      pending = Buffer.from(src.subarray(offset));
      return frames;
    },
    close() {
      if (closed) return;
      closed = true;
      pending = Buffer.alloc(0);
      try { encoder.delete(); } catch { /* ignore */ }
      try { decoder.delete(); } catch { /* ignore */ }
    },
  };
}

function createDemoCodec(kind) {
  if (kind === 'pcm16') return pcm16Codec();
  if (kind === 'pcm8') return pcm8Codec();
  if (kind === 'opus') return opusCodec();
  throw new Error('codec');
}

module.exports = {
  SAMPLE_RATE,
  FRAME_MS,
  FRAME_SAMPLES,
  PCM16_FRAME_BYTES,
  PCM8_FRAME_BYTES,
  OPUS_BITRATE,
  createDemoCodec,
};
