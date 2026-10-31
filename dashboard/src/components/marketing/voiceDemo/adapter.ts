import { DEMO_MAX_SEC } from "./machine";
import type { DemoBusinessKey, DemoLang } from "./copy";
import { NOTICE_V } from "./copy";

/**
 * POST /demo/token, then a session.
 * Voice PR2 owns the WebSocket frames. This adapter does not open a socket
 * and does not send audio. The mock is for local preview only.
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
  stop: () => void;
  onTick: (cb: (remainingSec: number) => void) => () => void;
  onLevel: (cb: (level: number) => void) => () => void;
  onEnd: (cb: (reason: string) => void) => () => void;
};

export type DemoSessionAdapter = {
  mint: (body: TokenRequest) => Promise<MintResult>;
  open: (session: { token: string; wsUrl: string; maxSec: number }) => DemoConnection;
};

export const NOTICE_VERSION = NOTICE_V;

type Listener<T> = (value: T) => void;

function createCountdown(maxSec: number, levels: boolean): DemoConnection {
  const ticks = new Set<Listener<number>>();
  const levelers = new Set<Listener<number>>();
  const ends = new Set<Listener<string>>();
  let left = maxSec;
  let stopped = false;
  const finish = (reason: string) => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    ends.forEach((cb) => cb(reason));
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
      // PR2 attaches the socket here. Until then the countdown is local and no audio leaves.
      return createCountdown(session.maxSec || DEMO_MAX_SEC, false);
    },
  };
}

export function demoAdapterFromEnv(): DemoSessionAdapter {
  if (process.env.NEXT_PUBLIC_DEMO_ADAPTER === "mock") return createMockDemoAdapter();
  return createHttpDemoAdapter();
}
