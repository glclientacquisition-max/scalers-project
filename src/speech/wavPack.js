// Pack mono PCM s16le into a WAV container.
// Live calls stay at the telephony rate. Desk preview uses 44.1 kHz PCM WAV
// so browsers have a supported <audio> source.

const BROWSER_PREVIEW_RATE = 44100;

/**
 * @param {Buffer} pcm Mono signed 16-bit little-endian PCM
 * @param {number} sampleRate
 */
function pcmToWav(pcm, sampleRate = 16000) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const even = data.length % 2 === 0 ? data : Buffer.concat([data, Buffer.from([0])]);
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + even.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(even.length, 40);
  return Buffer.concat([header, even]);
}

function upsamplePcm16Mono(pcm, fromRate, toRate) {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const even = data.length % 2 === 0 ? data : Buffer.concat([data, Buffer.from([0])]);
  if (!even.length || fromRate === toRate) return even;
  const inSamples = even.length / 2;
  const outSamples = Math.max(1, Math.round((inSamples * toRate) / fromRate));
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src = (i * fromRate) / toRate;
    const i0 = Math.min(inSamples - 1, Math.floor(src));
    const i1 = Math.min(inSamples - 1, i0 + 1);
    const frac = src - i0;
    const s0 = even.readInt16LE(i0 * 2);
    const s1 = even.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

/**
 * Browser-playable preview WAV: PCM s16le mono at 44.1 kHz, type audio/wav.
 * @param {Buffer} pcm
 * @param {number} sourceRate
 */
function pcmToBrowserWav(pcm, sourceRate = 16000) {
  return pcmToWav(upsamplePcm16Mono(pcm, sourceRate, BROWSER_PREVIEW_RATE), BROWSER_PREVIEW_RATE);
}

/**
 * Write raw WAV bytes on an Express response.
 * Express 4 `res.send(Uint8Array)` JSON-serializes the typed array
 * (`{"0":82,"1":73,...}`) while leaving Content-Type as audio/wav.
 * The desk then rejects the body as not a WAV.
 * @param {import('http').ServerResponse} res
 * @param {Buffer|Uint8Array} wav
 */
function writeWavResponse(res, wav) {
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || []);
  if (!res.getHeader || !res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'audio/wav');
  }
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
  return res;
}

module.exports = {
  pcmToWav,
  pcmToBrowserWav,
  upsamplePcm16Mono,
  writeWavResponse,
  BROWSER_PREVIEW_RATE,
};
