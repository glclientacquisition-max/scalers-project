import { DEMO_MAX_SEC, type DemoState } from "./machine";
import type { DemoBusinessKey, DemoLang } from "./copy";
import { NOTICE_V } from "./copy";
import type { AssistantPhase, EndReason, WireCodec } from "./protocol";
import { openDemoSocket } from "./socket";

/**
 * POST /demo/token, then /ws/demo. The mock never opens a socket.
 * Set NEXT_PUBLIC_DEMO_ADAPTER=mock for local preview only.
 */
export type TokenRequest = {
  tenant: DemoBusinessKey;
  lang: DemoLang;
  turnstile: string;
  device_id: string;
  consent_ts: string;
  notice_v: string;
};

export type MintResult =
  | { ok: true; token: string; wsUrl: string; maxSec: number }
  | { ok: false; status: number; reason: string };

export type DemoConnection = {
  stop: (notify?: boolean) => void;
  onReady: (cb: (info: { maxSec: number }) => void) => () => void;
  onUpgrade: (cb: (failure: { state: DemoState; reason: string }) => void) => () => void;
  onTick: (cb: (remainingSec: number) => void) => () => void;
  onLevel: (cb: (level: number) => void) => () => void;
  onPhase: (cb: (phase: AssistantPhase) => void) => () => void;
  onCaption: (cb: (caption: { role: "caller" | "assistant"; text: string }) => void) => () => void;
  onNotice: (cb: (text: string) => void) => () => void;
  onEnd: (cb: (reason: EndReason) => void) => () => void;
};

export type DemoOpen = {
  token: string;
  wsUrl: string;
  maxSec: number;
  stream?: MediaStream | null;
  codec?: WireCodec;
};

export type DemoSessionAdapter = {
  mint: (body: TokenRequest) => Promise<MintResult>;
  open: (session: DemoOpen) => DemoConnection;
};

type Listener<T> = (value: T) => void;

function subscribe<T>(set: Set<Listener<T>>, current: { value: T | undefined }, cb: Listener<T>) {
  set.add(cb);
  if (current.value !== undefined) cb(current.value);
  return () => set.delete(cb);
}

export const NOTICE_VERSION = NOTICE_V;

function createCountdown(maxSec: number, levels: boolean): DemoConnection {
  const ticks = new Set<Listener<number>>();
  const levelers = new Set<Listener<number>>();
  const ends = new Set<Listener<EndReason>>();
  const readies = new Set<Listener<{ maxSec: number }>>();
  const ready = { value: { maxSec } as { maxSec: number } | undefined };
  let left = maxSec;
  let stopped = false;
  const finish = (reason: string) => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    ends.forEach((cb) => cb(reason === "max_time" ? "max_time" : "error"));
  };
  const timer = window.setInterval(() => {
    if (stopped) return;
    left -= 1;
    ticks.forEach((cb) => cb(left));
    if (levels) {
      const wave = 0.35 + ((maxSec - left) % 4) * 0.12;
      levelers.forEach((cb) => cb(wave));
    }
    if (left <= 0) finish("max_time");
  }, 1000);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
    },
    onReady(cb) {
      return subscribe(readies, ready, cb);
    },
    onUpgrade() {
      return () => {};
    },
    onPhase() {
      return () => {};
    },
    onCaption() {
      return () => {};
    },
    onNotice() {
      return () => {};
    },
    onTick(cb) {
      ticks.add(cb);
      cb(left);
      return () => ticks.delete(cb);
    },
    onLevel(cb) {
      levelers.add(cb);
      return () => levelers.delete(cb);
    },
    onEnd(cb) {
      ends.add(cb);
      return () => ends.delete(cb);
    },
  };
}

export type MockScript = {
  result?: MintResult;
};

/** Local preview only. Does not call the voice server. */
export function createMockDemoAdapter(script: MockScript = {}): DemoSessionAdapter {
  return {
    async mint() {
      return (
        script.result ?? {
          ok: true,
          token: "mock",
          wsUrl: "",
          maxSec: DEMO_MAX_SEC,
        }
      );
    },
    open(session) {
      return createCountdown(session.maxSec || DEMO_MAX_SEC, true);
    },
  };
}

export function createHttpDemoAdapter(tokenUrl = "/demo/token"): DemoSessionAdapter {
  return {
    async mint(body) {
      let response: Response;
      try {
        response = await fetch(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        return { ok: false, status: 0, reason: "error" };
      }
      let payload: { token?: string; ws_url?: string; max_sec?: number; reason?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }
      if (!response.ok) {
        return { ok: false, status: response.status, reason: payload.reason || "error" };
      }
      if (!payload.token) return { ok: false, status: response.status, reason: "error" };
      return {
        ok: true,
        token: payload.token,
        wsUrl: payload.ws_url || "",
        maxSec: typeof payload.max_sec === "number" ? payload.max_sec : DEMO_MAX_SEC,
      };
    },
    open(session) {
      const ticks = new Set<Listener<number>>();
      const phases = new Set<Listener<AssistantPhase>>();
      const captions = new Set<Listener<{ role: "caller" | "assistant"; text: string }>>();
      const notices = new Set<Listener<string>>();
      const ends = new Set<Listener<EndReason>>();
      const readies = new Set<Listener<{ maxSec: number }>>();
      const upgrades = new Set<Listener<{ state: DemoState; reason: string }>>();
      const ready = { value: undefined as { maxSec: number } | undefined };
      const upgrade = { value: undefined as { state: DemoState; reason: string } | undefined };
      const ended = { value: undefined as EndReason | undefined };
      const handle = openDemoSocket(session.wsUrl, session.stream || null, {
        onReady(info) {
          ready.value = info;
          readies.forEach((cb) => cb(info));
        },
        onUpgrade(failure) {
          upgrade.value = failure;
          upgrades.forEach((cb) => cb(failure));
        },
        onTick(remaining) {
          ticks.forEach((cb) => cb(remaining));
        },
        onPhase(phase) {
          phases.forEach((cb) => cb(phase));
        },
        onCaption(caption) {
          captions.forEach((cb) => cb({ role: caption.role, text: caption.text }));
        },
        onNotice(text) {
          notices.forEach((cb) => cb(text));
        },
        onEnd(reason) {
          ended.value = reason;
          ends.forEach((cb) => cb(reason));
        },
      }, session.codec || "pcm16");
      return {
        stop(notify = false) {
          handle.stop(notify);
        },
        onReady(cb) {
          return subscribe(readies, ready, cb);
        },
        onUpgrade(cb) {
          return subscribe(upgrades, upgrade, cb);
        },
        onTick(cb) {
          ticks.add(cb);
          return () => ticks.delete(cb);
        },
        onLevel() {
          return () => {};
        },
        onPhase(cb) {
          phases.add(cb);
          return () => phases.delete(cb);
        },
        onCaption(cb) {
          captions.add(cb);
          return () => captions.delete(cb);
        },
        onNotice(cb) {
          notices.add(cb);
          return () => notices.delete(cb);
        },
        onEnd(cb) {
          return subscribe(ends, ended, cb);
        },
      };
    },
  };
}

export function demoAdapterFromEnv(): DemoSessionAdapter {
  if (process.env.NEXT_PUBLIC_DEMO_ADAPTER === "mock") return createMockDemoAdapter();
  return createHttpDemoAdapter();
}
