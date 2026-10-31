import { decodePcm16 } from "./pcm";
import { PCM16_RATE } from "./protocol";

/** Gapless pcm16 playback. stopNow drops every queued frame at once. */
export type PcmPlayer = {
  enqueue: (frame: ArrayBuffer, sampleRate?: number) => void;
  stopNow: () => void;
  close: () => void;
};

export function createPcmPlayer(context: AudioContext): PcmPlayer {
  const sources = new Set<AudioBufferSourceNode>();
  let nextTime = 0;
  let closed = false;
  return {
    enqueue(frame, sampleRate = PCM16_RATE) {
      if (closed || !frame.byteLength) return;
      const samples = decodePcm16(frame);
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const now = context.currentTime;
      if (nextTime < now) nextTime = now;
      source.start(nextTime);
      nextTime += buffer.duration;
      sources.add(source);
      source.onended = () => sources.delete(source);
    },
    stopNow() {
      nextTime = 0;
      sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      });
      sources.clear();
    },
    close() {
      closed = true;
      this.stopNow();
    },
  };
}
