// PCM helpers for emergency TTS (16 kHz mono s16le, same as SautiKit media).

function pcmDurationMs(pcm, sampleRate = 16000) {
  if (!pcm || !pcm.length || !sampleRate) return 0;
  return Math.ceil((pcm.length / 2 / sampleRate) * 1000);
}

function resampleS16le(input, fromRate, toRate) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!src.length || fromRate === toRate) return src;
  const inSamples = Math.floor(src.length / 2);
  if (inSamples < 1) return src;
  const outSamples = Math.max(1, Math.floor((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const pos = (i * fromRate) / toRate;
    const i0 = Math.min(inSamples - 1, Math.floor(pos));
    const i1 = Math.min(inSamples - 1, i0 + 1);
    const frac = pos - i0;
    const s0 = src.readInt16LE(i0 * 2);
    const s1 = src.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

/**
 * Extract PCM from a WAV container (espeak --stdout). Passes through raw PCM.
 */
function wavToPcm(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (data.length < 12) return data;
  if (data.slice(0, 4).toString() !== 'RIFF' || data.slice(8, 12).toString() !== 'WAVE') {
    return data;
  }
  let offset = 12;
  let sampleRate = 16000;
  while (offset + 8 <= data.length) {
    const id = data.slice(offset, offset + 4).toString();
    const size = data.readUInt32LE(offset + 4);
    const next = offset + 8 + size;
    if (id === 'fmt ' && size >= 16) {
      sampleRate = data.readUInt32LE(offset + 8 + 4);
    }
    if (id === 'data') {
      const pcm = data.subarray(offset + 8, Math.min(next, data.length));
      return { pcm, sampleRate };
    }
    offset = next + (size % 2);
  }
  return { pcm: data.subarray(44), sampleRate };
}

function wavBytesTo16kPcm(buf) {
  const parsed = wavToPcm(buf);
  if (Buffer.isBuffer(parsed)) return parsed;
  if (parsed.sampleRate && parsed.sampleRate !== 16000) {
    return resampleS16le(parsed.pcm, parsed.sampleRate, 16000);
  }
  return parsed.pcm;
}

module.exports = {
  pcmDurationMs,
  resampleS16le,
  wavToPcm,
  wavBytesTo16kPcm,
};
