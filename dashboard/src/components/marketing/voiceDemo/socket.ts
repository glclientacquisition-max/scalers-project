import type { DemoState } from "./machine";
import { createPcmPlayer, type PcmPlayer } from "./player";
import {
  CONNECT_MS,
  PCM8_RATE,
  PCM16_RATE,
  acceptSession,
  demoSocketUrl,
  parseServerMessage,
  stopsPlayback,
  type AssistantPhase,
  type EndReason,
  type ServerCaption,
  type WireCodec,
} from "./protocol";
import { demoStatusUrl } from "./device";
import { readDemoStatus } from "./status";

export type DemoSocketHandlers = {
  onReady: (info: { maxSec: number }) => void;
  onUpgrade: (failure: { state: DemoState; reason: string }) => void;
  onTick: (remainingSec: number) => void;
  onPhase: (phase: AssistantPhase) => void;
  onCaption: (caption: ServerCaption) => void;
  onNotice: (text: string) => void;
  onEnd: (reason: EndReason) => void;
};

const WORKLET_URL = "/voice-demo-pcm-worklet.js";

/**
 * Real /ws/demo session. Touch and phones send pcm8. Desktop sends pcm16.
 * Sends {type:'end'} on visitor stop. Captions stay in memory only.
 * A failed HTTP upgrade asks GET /demo/status once, then shows that state or a generic error.
 */
export function openDemoSocket(
  wsUrl: string,
  stream: MediaStream | null,
  handlers: DemoSocketHandlers,
  codec: WireCodec = "pcm16",
): { stop: (notify: boolean) => void } {
  const captureRate = codec === "pcm8" ? PCM8_RATE : PCM16_RATE;
  let url = "";
  try {
    url = demoSocketUrl(wsUrl, codec);
  } catch {
    handlers.onUpgrade({ state: "error", reason: "error" });
    return { stop() {} };
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    handlers.onUpgrade({ state: "error", reason: "error" });
    return { stop() {} };
  }
  socket.binaryType = "arraybuffer";

  let player: PcmPlayer | null = null;
  let context: AudioContext | null = null;
  let worklet: AudioWorkletNode | null = null;
  let mute: GainNode | null = null;
  let playRate = captureRate;
  let ready = false;
  let closed = false;
  let failing = false;
  let timer = 0;
  let left = 0;
  const connectTimer = window.setTimeout(() => {
    if (!ready && !closed) void failHttp();
  }, CONNECT_MS);

  function clearClock() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  async function failHttp() {
    if (closed || ready || failing) return;
    failing = true;
    closed = true;
    window.clearTimeout(connectTimer);
    clearClock();
    teardown(false);
    const read = await readDemoStatus(fetch, demoStatusUrl());
    if (read.kind === "block") {
      handlers.onUpgrade({ state: read.state, reason: read.state });
      return;
    }
    handlers.onUpgrade({ state: "error", reason: "error" });
  }

  function teardown(notify: boolean) {
    if (notify && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "end" }));
      } catch {
        // The socket is already going away.
      }
    }
    player?.close();
    player = null;
    try {
      worklet?.disconnect();
    } catch {
      // Already disconnected.
    }
    worklet = null;
    try {
      mute?.disconnect();
    } catch {
      // Already disconnected.
    }
    mute = null;
    void context?.close();
    context = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  async function attachMic() {
    if (!stream) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      context = new Ctx({ sampleRate: captureRate });
    } catch {
      context = new Ctx();
    }
    try {
      await context.resume();
      await context.audioWorklet.addModule(WORKLET_URL);
      const source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, "pcm-capture", {
        processorOptions: { rate: captureRate },
      });
      mute = context.createGain();
      mute.gain.value = 0;
      source.connect(worklet);
      worklet.connect(mute);
      mute.connect(context.destination);
      worklet.port.onmessage = (event) => {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        if (event.data instanceof ArrayBuffer) socket.send(event.data);
      };
      player = createPcmPlayer(context);
    } catch {
      // The mic is open but the worklet did not start. The socket can still play.
      if (context) player = createPcmPlayer(context);
    }
  }

  socket.onopen = () => {
    void attachMic();
  };

  socket.onmessage = (event) => {
    if (closed) return;
    if (typeof event.data !== "string") {
      if (event.data instanceof ArrayBuffer) player?.enqueue(event.data, playRate);
      return;
    }
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === "session") {
      const accepted = acceptSession(message);
      if (!accepted.ok) {
        closed = true;
        window.clearTimeout(connectTimer);
        clearClock();
        teardown(false);
        handlers.onUpgrade({ state: "error", reason: accepted.reason === "tenant" ? "tenant" : "error" });
        return;
      }
      ready = true;
      window.clearTimeout(connectTimer);
      left = accepted.maxSec;
      handlers.onReady({ maxSec: accepted.maxSec });
      handlers.onTick(left);
      clearClock();
      timer = window.setInterval(() => {
        left -= 1;
        handlers.onTick(left);
        if (left <= 0) clearClock();
      }, 1000);
      return;
    }
    if (message.type === "state") {
      handlers.onPhase(message.state);
      if (stopsPlayback(message.state)) player?.stopNow();
      return;
    }
    if (message.type === "assistant_audio") {
      if (message.sampleRate === PCM8_RATE || message.sampleRate === PCM16_RATE) playRate = message.sampleRate;
      return;
    }
    if (message.type === "caption") {
      handlers.onCaption(message);
      return;
    }
    if (message.type === "error" && message.message) {
      handlers.onNotice(message.message);
      return;
    }
    if (message.type === "end") {
      if (closed) return;
      closed = true;
      window.clearTimeout(connectTimer);
      clearClock();
      teardown(false);
      handlers.onEnd(message.reason);
    }
  };

  socket.onerror = () => {
    if (ready || closed) return;
    void failHttp();
  };

  socket.onclose = () => {
    if (closed) return;
    if (!ready) {
      void failHttp();
      return;
    }
    closed = true;
    window.clearTimeout(connectTimer);
    clearClock();
    player?.close();
  };

  return {
    stop(notify: boolean) {
      if (closed) return;
      closed = true;
      window.clearTimeout(connectTimer);
      clearClock();
      teardown(notify);
    },
  };
}
