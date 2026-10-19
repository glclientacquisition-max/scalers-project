// Telephony recordings: WAV (8/16 kHz mono) → MP3 before Storage upload.
// Pure JS via @breezystack/lamejs (ESM dynamic import; CJS require is empty on Node 22).
// Railway image has no ffmpeg (Dockerfile: espeak-ng only). On failure, callers keep WAV.

const { wavToPcm } = require('../speech/pcmUtil');

const DEFAULT_MP3_KBPS = 24;

let lameModulePromise;

async function getMp3Encoder() {
  if (!lameModulePromise) {
    lameModulePromise = import('@breezystack/lamejs');
  }
  const mod = await lameModulePromise;
  return mod.Mp3Encoder;
}

function isMp3Buffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length < 3) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}

function isWavBuffer(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  return b.length >= 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE';
}

/**
 * @param {Buffer} wavBuffer
 * @param {{ kbps?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
async function encodeWavToMp3(wavBuffer, { kbps = DEFAULT_MP3_KBPS } = {}) {
  const Mp3Encoder = await getMp3Encoder();
  const parsed = wavToPcm(wavBuffer);
  let pcm;
  let sampleRate;
  if (Buffer.isBuffer(parsed)) {
    pcm = parsed;
    sampleRate = 8000;
  } else {
    pcm = parsed.pcm;
    sampleRate = parsed.sampleRate || 8000;
  }
  if (!pcm || !pcm.length) {
    throw new Error('empty PCM in WAV');
  }
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks = [];
  const bytesPerBlock = 1152 * 2;
  for (let offset = 0; offset < pcm.length; offset += bytesPerBlock) {
    const slice = pcm.subarray(offset, Math.min(offset + bytesPerBlock, pcm.length));
    const samples = new Int16Array(slice.buffer, slice.byteOffset, Math.floor(slice.length / 2));
    const mp3buf = encoder.encodeBuffer(samples);
    if (mp3buf && mp3buf.length) chunks.push(Buffer.from(mp3buf));
  }
  const tail = encoder.flush();
  if (tail && tail.length) chunks.push(Buffer.from(tail));
  const out = Buffer.concat(chunks);
  if (!out.length) throw new Error('encoder produced empty MP3');
  return out;
}

/**
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string, encoded: boolean, encodeError?: Error }>}
 */
async function prepareRecordingForUpload(buffer, contentType, extension, opts = {}) {
  const ct = String(contentType || '').toLowerCase();
  const ext = String(extension || '').toLowerCase();
  if (ext === 'mp3' || ct.includes('mpeg') || ct.includes('mp3') || isMp3Buffer(buffer)) {
    return { buffer, contentType: 'audio/mpeg', extension: 'mp3', encoded: false };
  }
  if (ext === 'wav' || ct.includes('wav') || isWavBuffer(buffer)) {
    try {
      const mp3 = await encodeWavToMp3(buffer, opts);
      return { buffer: mp3, contentType: 'audio/mpeg', extension: 'mp3', encoded: true };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        buffer,
        contentType: ct.includes('wav') ? contentType : 'audio/wav',
        extension: 'wav',
        encoded: false,
        encodeError: error,
      };
    }
  }
  return {
    buffer,
    contentType: contentType || 'application/octet-stream',
    extension: ext || 'bin',
    encoded: false,
  };
}

/** ~bytes per second at DEFAULT_MP3_KBPS mono CBR (for ops estimates). */
function expectedMp3BytesPerSecond(kbps = DEFAULT_MP3_KBPS) {
  return Math.round((kbps * 1000) / 8);
}

module.exports = {
  DEFAULT_MP3_KBPS,
  encodeWavToMp3,
  prepareRecordingForUpload,
  isMp3Buffer,
  isWavBuffer,
  expectedMp3BytesPerSecond,
};
