import type { DemoState } from "./machine";

/** Fixture ids from the demo tenant seed. A session for any other id is refused. */
export const DEMO_TENANT_IDS = {
  demo_home: "11111111-1111-4111-8111-111111111101",
  demo_shop: "11111111-1111-4111-8111-111111111102",
  demo_other: "11111111-1111-4111-8111-111111111103",
} as const;

const TENANT_ID_SET = new Set<string>(Object.values(DEMO_TENANT_IDS));

export const PCM16_FRAME_BYTES = 640;
export const PCM16_FRAME_SAMPLES = 320;
export const PCM16_RATE = 16000;
export const PCM8_FRAME_BYTES = 320;
export const PCM8_FRAME_SAMPLES = 160;
export const PCM8_RATE = 8000;
export const CONNECT_MS = 5000;

export const END_REASONS = ["max_time", "idle", "user", "cap", "kill", "error"] as const;
export type EndReason = (typeof END_REASONS)[number];

export const ASSISTANT_PHASES = ["greeting", "listening", "thinking", "speaking"] as const;
export type AssistantPhase = (typeof ASSISTANT_PHASES)[number];

export type DemoCodec = "pcm16" | "pcm8" | "opus";
export type WireCodec = "pcm16" | "pcm8";

/** Touch or a narrow phone uses 8 kHz. Desktop stays 16 kHz. Opus is never chosen here. */
export function preferredDemoCodec(hints: { coarsePointer?: boolean; touchPoints?: number; narrow?: boolean }): WireCodec {
  if (hints.coarsePointer || (hints.touchPoints || 0) > 0 || hints.narrow) return "pcm8";
  return "pcm16";
}

export function readDeviceCodec(): WireCodec {
  if (typeof window === "undefined") return "pcm16";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 767px)").matches;
  const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0;
  return preferredDemoCodec({ coarsePointer: coarse, touchPoints, narrow });
}

export function isDemoTenantId(id: string): boolean {
  return TENANT_ID_SET.has(id);
}

export function isEndReason(value: string): value is EndReason {
  return (END_REASONS as readonly string[]).includes(value);
}

export function isAssistantPhase(value: string): value is AssistantPhase {
  return (ASSISTANT_PHASES as readonly string[]).includes(value);
}

/** Opus is only when the caller passes it. The widget passes pcm8 or pcm16. */
export function demoSocketUrl(wsUrl: string, codec: DemoCodec = "pcm16"): string {
  const url = new URL(wsUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  url.searchParams.set("codec", codec);
  return url.toString();
}

/**
 * Failed upgrades are HTTP. The body is {reason} and X-Demo-Reason repeats it.
 * 404 disabled, 403 origin, 400 codec, 401 rejected | expired | reused | tenant.
 */
export function stateForUpgrade(status: number, reason: string): DemoState {
  if (status === 404 || reason === "disabled") return "disabled";
  if (status === 400 || reason === "codec") return "unsupported";
  if (status === 403 || reason === "origin") return "error";
  if (
    status === 401 &&
    (reason === "rejected" || reason === "expired" || reason === "reused" || reason === "tenant")
  ) {
    return "error";
  }
  if (reason === "rejected" || reason === "expired" || reason === "reused" || reason === "tenant") {
    return "error";
  }
  return "error";
}

export type ServerSession = {
  type: "session";
  maxSec: number;
  recording: boolean;
  tenantId: string;
  lang: "en" | "sw";
  codec: string;
};

export type ServerCaption = {
  type: "caption";
  role: "caller" | "assistant";
  text: string;
  final: boolean;
  lang: string;
};

export type ServerMessage =
  | ServerSession
  | { type: "state"; state: AssistantPhase }
  | ServerCaption
  | { type: "assistant_audio"; streamId: string; sampleRate: number }
  | { type: "error"; reason: string; message: string }
  | { type: "end"; reason: EndReason };

export function parseServerMessage(raw: string): ServerMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const row = msg as { type?: unknown; [key: string]: unknown };
  if (row.type === "session") {
    const tenantId = typeof row.tenant_id === "string" ? row.tenant_id : "";
    const maxSec = typeof row.max_sec === "number" ? row.max_sec : 180;
    return {
      type: "session",
      maxSec,
      recording: row.recording === true,
      tenantId,
      lang: row.lang === "sw" ? "sw" : "en",
      codec: typeof row.codec === "string" ? row.codec : "pcm16",
    };
  }
  if (row.type === "state" && typeof row.state === "string" && isAssistantPhase(row.state)) {
    return { type: "state", state: row.state };
  }
  if (row.type === "caption" && typeof row.text === "string") {
    return {
      type: "caption",
      role: row.role === "assistant" ? "assistant" : "caller",
      text: row.text,
      final: row.final === true,
      lang: typeof row.lang === "string" ? row.lang : "en",
    };
  }
  if (row.type === "assistant_audio") {
    return {
      type: "assistant_audio",
      streamId: typeof row.stream_id === "string" ? row.stream_id : "",
      sampleRate: typeof row.sample_rate === "number" ? row.sample_rate : PCM16_RATE,
    };
  }
  if (row.type === "error") {
    return {
      type: "error",
      reason: typeof row.reason === "string" ? row.reason : "error",
      message: typeof row.message === "string" ? row.message : "",
    };
  }
  if (row.type === "end" && typeof row.reason === "string" && isEndReason(row.reason)) {
    return { type: "end", reason: row.reason };
  }
  return null;
}

/** Listening is the barge-in signal. Stop playback at once. */
export function stopsPlayback(phase: AssistantPhase): boolean {
  return phase === "listening";
}

export function acceptSession(message: ServerSession): { ok: true; maxSec: number } | { ok: false; reason: "tenant" | "recording" } {
  if (message.recording) return { ok: false, reason: "recording" };
  if (!isDemoTenantId(message.tenantId)) return { ok: false, reason: "tenant" };
  const maxSec = message.maxSec > 0 ? message.maxSec : 180;
  return { ok: true, maxSec };
}
