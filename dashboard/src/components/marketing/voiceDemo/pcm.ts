const PCM16_SAMPLES = 320;
const PCM16_RATE = 16000;
const PCM8_SAMPLES = 160;
const PCM8_RATE = 8000;

function frameSamples(rate: number): number {
  return rate === PCM8_RATE ? PCM8_SAMPLES : PCM16_SAMPLES;
}

/** One 20 ms little-endian frame. 8 kHz is 320 bytes. 16 kHz is 640 bytes. */
export function encodePcmFrame(samples: ArrayLike<number>, rate = PCM16_RATE): ArrayBuffer {
  const size = frameSamples(rate);
  const bytes = new Uint8Array(size * 2);
  const count = Math.min(samples.length, size);
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

export function encodePcm16Frame(samples: ArrayLike<number>): ArrayBuffer {
  return encodePcmFrame(samples, PCM16_RATE);
}

/**
 * Resample mono float audio and split it into 20 ms frames.
 * 8 kHz frames are 320 bytes. 16 kHz frames are 640 bytes.
 */
export function framesFromFloat(
  input: ArrayLike<number>,
  inputRate: number,
  carry = 0,
  targetRate = PCM16_RATE,
): { frames: ArrayBuffer[]; carry: number } {
  const step = inputRate / targetRate;
  const size = frameSamples(targetRate);
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
  while (pending.length - offset >= size) {
    frames.push(encodePcmFrame(pending.slice(offset, offset + size), targetRate));
    offset += size;
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
