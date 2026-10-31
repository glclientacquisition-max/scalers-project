import { createPcmPlayer, type PcmPlayer } from "./player";
import {
  CONNECT_MS,
  PCM16_RATE,
  acceptSession,
  demoSocketUrl,
  parseServerMessage,
  stopsPlayback,
  type AssistantPhase,
  type EndReason,
  type ServerCaption,
} from "./protocol";

export type DemoSocketHandlers = {
  onReady: (info: { maxSec: number }) => void;
  onUpgrade: (failure: { status: number; reason: string }) => void;
  onTick: (remainingSec: number) => void;
  onPhase: (phase: AssistantPhase) => void;
  onCaption: (caption: ServerCaption) => void;
  onNotice: (text: string) => void;
  onEnd: (reason: EndReason) => void;
};

const WORKLET_URL = "/voice-demo-pcm-worklet.js";

function statusFromTiming(needle: string): number {
  if (typeof performance === "undefined") return 0;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || !entry.name.includes(needle)) continue;
    return entry.responseStatus || 0;
  }
  return 0;
}

function reasonForStatus(status: number): string {
  if (status === 404) return "disabled";
  if (status === 403) return "origin";
  if (status === 400) return "codec";
  if (status === 401) return "rejected";
  return "error";
}

/**
 * Real /ws/demo session. pcm16 by default. Sends {type:'end'} on visitor stop.
 * Captions stay in memory for the open socket only.
 */
export function openDemoSocket(
  wsUrl: string,
  stream: MediaStream | null,
  handlers: DemoSocketHandlers,
): { stop: (notify: boolean) => void } {
  let url = "";
  try {
    url = demoSocketUrl(wsUrl, "pcm16");
  } catch {
    handlers.onUpgrade({ status: 0, reason: "error" });
    return { stop() {} };
  }

  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    handlers.onUpgrade({ status: 0, reason: "error" });
    return { stop() {} };
  }
  socket.binaryType = "arraybuffer";

  let player: PcmPlayer | null = null;
  let context: AudioContext | null = null;
  let worklet: AudioWorkletNode | null = null;
  let mute: GainNode | null = null;
  let ready = false;
  let closed = false;
  let timer = 0;
  let left = 0;
  const connectTimer = window.setTimeout(() => {
    if (!ready && !closed) fail(0, "error");
  }, CONNECT_MS);

  function clearClock() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  function fail(status: number, reason: string) {
    if (closed) return;
    closed = true;
    window.clearTimeout(connectTimer);
    clearClock();
    teardown(false);
    handlers.onUpgrade({ status, reason });
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
      context = new Ctx({ sampleRate: PCM16_RATE });
    } catch {
      context = new Ctx();
    }
    try {
      await context.resume();
      await context.audioWorklet.addModule(WORKLET_URL);
      const source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, "pcm16-capture");
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
      if (event.data instanceof ArrayBuffer) player?.enqueue(event.data, PCM16_RATE);
      return;
    }
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === "session") {
      const accepted = acceptSession(message);
      if (!accepted.ok) {
        fail(accepted.reason === "tenant" ? 401 : 0, accepted.reason === "tenant" ? "tenant" : "error");
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
    window.setTimeout(() => {
      if (ready || closed) return;
      const status = statusFromTiming("/ws/demo");
      fail(status, reasonForStatus(status));
    }, 0);
  };

  socket.onclose = () => {
    if (closed) return;
    if (!ready) {
      const status = statusFromTiming("/ws/demo");
      fail(status, reasonForStatus(status));
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
