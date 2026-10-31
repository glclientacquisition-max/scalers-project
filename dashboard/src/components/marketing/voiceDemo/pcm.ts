const FRAME_SAMPLES = 320;
const RATE = 16000;

/** One 20 ms frame, 16 kHz, little-endian pcm16. 320 samples, 640 bytes. */
export function encodePcm16Frame(samples: ArrayLike<number>): ArrayBuffer {
  const bytes = new Uint8Array(FRAME_SAMPLES * 2);
  const count = Math.min(samples.length, FRAME_SAMPLES);
  for (let i = 0; i < count; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] || 0));
    let n = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    if (n < -32768) n = -32768;
    if (n > 32767) n = 32767;
    bytes[i * 2] = n & 0xff;
    bytes[i * 2 + 1] = (n >> 8) & 0xff;
  }
  return bytes.buffer;
}

/**
 * Resample mono float audio to 16 kHz and split it into 640-byte frames.
 * `carry` is the fractional read position left over from the previous block.
 */
export function framesFromFloat(
  input: ArrayLike<number>,
  inputRate: number,
  carry = 0,
): { frames: ArrayBuffer[]; carry: number } {
  const step = inputRate / RATE;
  const pending: number[] = [];
  let pos = carry;
  while (pos < input.length) {
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = input[index] || 0;
    const b = index + 1 < input.length ? input[index + 1] || 0 : a;
    pending.push(a + (b - a) * frac);
    pos += step;
  }
  const frames: ArrayBuffer[] = [];
  let offset = 0;
  while (pending.length - offset >= FRAME_SAMPLES) {
    frames.push(encodePcm16Frame(pending.slice(offset, offset + FRAME_SAMPLES)));
    offset += FRAME_SAMPLES;
  }
  return { frames, carry: pos - input.length };
}

export function decodePcm16(buffer: ArrayBuffer): Float32Array {
  const bytes = new Uint8Array(buffer);
  const samples = Math.floor(bytes.length / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    let n = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    if (n & 0x8000) n -= 0x10000;
    out[i] = n < 0 ? n / 0x8000 : n / 0x7fff;
  }
  return out;
}
