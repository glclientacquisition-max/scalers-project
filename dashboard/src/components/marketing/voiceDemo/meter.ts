/** Local mic level only. Frames are dropped. Nothing is recorded or uploaded. */
export type DemoMeter = {
  start: (stream: MediaStream) => void;
  stop: () => void;
  onLevel: (cb: (level: number) => void) => () => void;
};

export function createMicMeter(): DemoMeter {
  const listeners = new Set<(level: number) => void>();
  let context: AudioContext | null = null;
  let raf = 0;
  let source: MediaStreamAudioSourceNode | null = null;
  return {
    start(stream) {
      this.stop();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      context = new Ctx();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const sample = (data[i] - 128) / 128;
          sum += sample * sample;
        }
        const level = Math.min(1, Math.sqrt(sum / data.length) * 3);
        listeners.forEach((cb) => cb(level));
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    },
    stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      source?.disconnect();
      source = null;
      void context?.close();
      context = null;
    },
    onLevel(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export async function captureMic(): Promise<MediaStream | "denied" | "unsupported"> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    return "unsupported";
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      video: false,
    });
  } catch {
    return "denied";
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
