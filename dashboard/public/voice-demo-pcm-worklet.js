// Mic to little-endian pcm. 8 kHz is 320 bytes / 20 ms. 16 kHz is 640 bytes / 20 ms.
// processorOptions.rate is 8000 or 16000. Keep in step with pcm.ts.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = options && options.processorOptions && options.processorOptions.rate;
    this.rate = asked === 8000 ? 8000 : 16000;
    this.frame = this.rate === 8000 ? 160 : 320;
    this.step = sampleRate / this.rate;
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
      if (this.pending.length === this.frame) {
        const bytes = new Uint8Array(this.frame * 2);
        for (let i = 0; i < this.frame; i += 1) {
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

registerProcessor("pcm-capture", PcmCapture);
