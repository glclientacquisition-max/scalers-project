/**
 * Server-only SautiKit REST client (Super Admin features).
 * Auth: Authorization: Bearer SAUTIKIT_API_KEY — never expose to the browser.
 */

const BASE = (process.env.SAUTIKIT_API_BASE || "https://api.sautikit.com").replace(
  /\/+$/,
  ""
);

export type SautikitNumber = {
  id: string;
  e164: string;
  country_iso2: string;
  status: string;
  monthly_retail_minor: number;
  currency: string;
  inbound_per_min_minor: number;
  outbound_per_min_minor: number;
  claimed_at: string | null;
  capabilities: string[];
  voice_callback_url: string | null;
  events_url: string | null;
};

export type SautikitWallet = {
  balance_minor: number;
  currency: string;
  status?: string;
};

/** Safe, non-secret summary of whatever key Vercel currently has loaded. */
export type SautikitKeyDiagnostics = {
  configured: boolean;
  startsWithEyJ: boolean;
  length: number;
  label: string | null;
  scopes: string[];
  workspaceId: string | null;
  fingerprint: string | null;
  issues: string[];
};

/**
 * Strip common paste mistakes so Vercel/Railway env typos don't look like
 * "revoked" / "invalid" mysteries.
 */
export function normalizeSautikitApiKey(raw: string | undefined | null): string {
  let key = String(raw || "").trim();
  // Accidental "NAME=value" paste into the value field
  if (key.startsWith("SAUTIKIT_API_KEY=")) {
    key = key.slice("SAUTIKIT_API_KEY=".length).trim();
  }
  // Accidental quotes from .env copy-paste
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  // Accidental "Bearer eyJ..." paste
  if (/^Bearer\s+/i.test(key)) {
    key = key.replace(/^Bearer\s+/i, "").trim();
  }
  return key;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getSautikitApiKey(): string {
  return normalizeSautikitApiKey(process.env.SAUTIKIT_API_KEY);
}

export function isSautikitConfigured(): boolean {
  return Boolean(getSautikitApiKey());
}

export function getSautikitKeyDiagnostics(): SautikitKeyDiagnostics {
  const key = getSautikitApiKey();
  const issues: string[] = [];
  if (!key) {
    return {
      configured: false,
      startsWithEyJ: false,
      length: 0,
      label: null,
      scopes: [],
      workspaceId: null,
      fingerprint: null,
      issues: ["SAUTIKIT_API_KEY is missing on this server (Vercel Production)."],
    };
  }

  const startsWithEyJ = key.startsWith("eyJ");
  if (!startsWithEyJ) {
    issues.push(
      "Key does not start with eyJ — the Vercel value is malformed (often pasted as SAUTIKIT_API_KEY=eyJ…)."
    );
  }

  const payload = decodeJwtPayload(key);
  const label =
    payload && typeof payload.key_label === "string" ? payload.key_label : null;
  const scopes = Array.isArray(payload?.scopes)
    ? payload!.scopes.filter((s): s is string => typeof s === "string")
    : [];
  const workspaceId =
    payload && typeof payload.workspace_id === "string" ? payload.workspace_id : null;

  if (!payload) {
    issues.push("Key is not a readable JWT — check for truncation in Vercel.");
  } else {
    if (!workspaceId) {
      issues.push("Key has no workspace_id — mint a workspace key, not a personal key.");
    }
    if (!scopes.includes("numbers.read")) {
      issues.push("Key is missing numbers.read scope.");
    }
    if (!scopes.includes("wallet.read")) {
      issues.push("Key is missing wallet.read scope (wallet panel will be empty).");
    }
  }

  const fingerprint = key.length >= 8 ? `…${key.slice(-8)}` : null;

  return {
    configured: true,
    startsWithEyJ,
    length: key.length,
    label,
    scopes,
    workspaceId,
    fingerprint,
    issues,
  };
}

async function sautikitGet<T>(path: string): Promise<T> {
  const apiKey = getSautikitApiKey();
  if (!apiKey) throw new Error("SAUTIKIT_API_KEY is not configured");

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    // Never cache auth'd SautiKit responses — a revoked-key 401 must not stick
    // after the env var is rotated on Vercel.
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err =
      json && typeof json === "object" && "error" in json
        ? (json.error as { code?: string; message?: string })
        : null;
    const e = new Error(
      `SautiKit ${path}: ${err?.message || `HTTP ${res.status}`}${
        err?.code ? ` (${err.code})` : ""
      }`
    ) as Error & { status?: number; code?: string };
    e.status = res.status;
    e.code = err?.code;
    throw e;
  }
  return json as T;
}

export async function listSautikitNumbers(): Promise<SautikitNumber[]> {
  const json = await sautikitGet<{ numbers: SautikitNumber[] }>("/v1/numbers");
  return json.numbers || [];
}

/**
 * Prepaid platform wallet. Requires an API key with the `wallet.read` scope —
 * returns null when the current key lacks it (403 api_key.scope_denied).
 */
export async function getSautikitWallet(): Promise<SautikitWallet | null> {
  try {
    return await sautikitGet<SautikitWallet>("/v1/wallet");
  } catch (err) {
    const status = (err as { status?: number }).status;
    const code = (err as { code?: string }).code;
    if (status === 403 || code === "api_key.scope_denied") return null;
    throw err;
  }
}

export function formatMinor(minor: number, currency: string): string {
  const major = (Number(minor) || 0) / 100;
  return `${currency} ${major.toLocaleString("en-KE", {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
