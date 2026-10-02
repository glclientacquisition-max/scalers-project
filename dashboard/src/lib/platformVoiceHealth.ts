import { getVoicePublicBase } from "@/lib/sautikit";

const HEALTHZ_TIMEOUT_MS = 8_000;

export type SonioxChannelError = {
  billing?: boolean;
  fatal?: boolean;
  code?: string | null;
  type?: string | null;
  message?: string | null;
  at?: string | null;
} | null;

export type SonioxHealthSnapshot = {
  stt: SonioxChannelError;
  tts: SonioxChannelError;
  billingExhausted?: boolean;
};

export type GeminiHealthSnapshot = {
  lastError: {
    kind?: string | null;
    retryable?: boolean;
    message?: string | null;
    at?: string | null;
  } | null;
  lastOkAt?: string | null;
  billingExhausted?: boolean;
  denied?: boolean;
};

export type VoiceHealthzPayload = {
  ok?: boolean;
  gitSha?: string | null;
  soniox?: {
    stt?: boolean;
    tts?: boolean;
    lastError?: SonioxHealthSnapshot;
  };
  gemini?: {
    configured?: boolean;
    lastError?: GeminiHealthSnapshot;
  };
};

export type VoiceHealthFetch =
  | { status: "ok"; payload: VoiceHealthzPayload }
  | { status: "unreachable"; message: string }
  | { status: "invalid"; message: string };

/** Server-only: read Voice `GET /healthz` (no auth required). */
export async function fetchVoiceHealthz(): Promise<VoiceHealthFetch> {
  const base = getVoicePublicBase();
  let url: string;
  try {
    url = new URL("/healthz", `${base}/`).toString();
  } catch {
    return { status: "invalid", message: `Invalid voice base URL (${base})` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTHZ_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        status: "unreachable",
        message: `Voice health returned HTTP ${res.status}`,
      };
    }
    const payload = (await res.json()) as VoiceHealthzPayload;
    return { status: "ok", payload };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Voice health timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return { status: "unreachable", message };
  } finally {
    clearTimeout(timer);
  }
}
