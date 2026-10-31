// Mic to 16 kHz little-endian pcm16, 640 bytes every 20 ms.
// Keep the resample in step with dashboard/src/components/marketing/voiceDemo/pcm.ts.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.pos = 0;
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || !channel.length) return true;
    let pos = this.pos;
    while (pos < channel.length) {
      const index = Math.floor(pos);
      const frac = pos - index;
      const a = channel[index] || 0;
      const b = index + 1 < channel.length ? channel[index + 1] : a;
      const sample = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.pending.push(sample);
      if (this.pending.length === 320) {
        const bytes = new Uint8Array(640);
        for (let i = 0; i < 320; i += 1) {
          const value = this.pending[i];
          let n = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff);
          if (n < -32768) n = -32768;
          if (n > 32767) n = 32767;
          bytes[i * 2] = n & 0xff;
          bytes[i * 2 + 1] = (n >> 8) & 0xff;
        }
        this.pending = [];
        this.port.postMessage(bytes.buffer, [bytes.buffer]);
      }
      pos += this.step;
    }
    this.pos = pos - channel.length;
    return true;
  }
}

registerProcessor("pcm16-capture", Pcm16Capture);
