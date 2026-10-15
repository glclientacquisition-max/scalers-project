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

export type SmsCreditHealth = {
  configured?: boolean;
  verified?: boolean | null;
  balance?: number | null;
  checkedAt?: string | null;
  state?: "ok" | "warn" | "critical" | "exhausted" | "unknown";
  runwayDays?: number | null;
};

export type TelephonyHealthSnapshot = {
  billingExhausted?: boolean;
  balanceMinor?: number | null;
  currency?: string | null;
  message?: string | null;
  at?: string | null;
};

export type SonioxBalanceHealth = {
  configured?: boolean;
  state?: "ok" | "warn" | "critical" | "exhausted" | "unknown";
  balanceUsd?: number | null;
  autopay?: boolean | null;
  invoiceBilling?: boolean | null;
  paymentError?: boolean | null;
  checkedAt?: string | null;
  error?: string | null;
};

export type ScopeCheck = { scope: string; ok: boolean };

export type VoiceHealthzPayload = {
  ok?: boolean;
  checkedAt?: string | null;
  environment?: string | null;
  gitBranch?: string | null;
  startedAt?: string | null;
  sms?: SmsCreditHealth;
  sonioxBalance?: SonioxBalanceHealth;
  keyScopes?: {
    sautikit?: { configured?: boolean; workspaceId?: string | null; checks?: ScopeCheck[] };
  };
  telephony?: { configured?: boolean; lastError?: TelephonyHealthSnapshot | null };
  notify?: {
    whatsapp?: boolean;
    email?: boolean;
  };
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

export type VoiceEnv = "prod" | "staging";

/** Voice base URL per environment. Staging needs VOICE_STAGING_PUBLIC_URL. */
export function voiceBaseFor(env: VoiceEnv): string | null {
  if (env === "prod") return getVoicePublicBase();
  const raw = String(process.env.VOICE_STAGING_PUBLIC_URL || "").trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

function adminHealthToken(env: VoiceEnv): string {
  const raw =
    env === "staging"
      ? process.env.ADMIN_HEALTH_TOKEN_STAGING || process.env.ADMIN_HEALTH_TOKEN
      : process.env.ADMIN_HEALTH_TOKEN;
  return String(raw || "").trim();
}

/**
 * Server-only: Voice `GET /admin/health` (Bearer ADMIN_HEALTH_TOKEN). Read-only.
 * Public /healthz only carries ok/sha now; balances and errors live here.
 */
export async function fetchVoiceAdminHealth(env: VoiceEnv): Promise<VoiceHealthFetch> {
  const base = voiceBaseFor(env);
  if (!base) {
    return { status: "invalid", message: "VOICE_STAGING_PUBLIC_URL not set" };
  }
  const token = adminHealthToken(env);
  if (!token) {
    return { status: "invalid", message: "ADMIN_HEALTH_TOKEN not set on the Desk" };
  }
  let url: string;
  try {
    url = new URL("/admin/health", `${base}/`).toString();
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
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { status: "unreachable", message: "Voice refused the admin health token" };
    if (res.status === 503) return { status: "unreachable", message: "ADMIN_HEALTH_TOKEN not set on Voice" };
    if (res.status === 404) return { status: "unreachable", message: "Voice has no /admin/health yet (old deploy)" };
    if (!res.ok) return { status: "unreachable", message: `Voice admin health returned HTTP ${res.status}` };
    return { status: "ok", payload: (await res.json()) as VoiceHealthzPayload };
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
