/**
 * Server-only SautiKit REST client (Super Admin features).
 * Auth: Authorization: Bearer SAUTIKIT_API_KEY — never expose to the browser.
 */

const BASE = process.env.SAUTIKIT_API_BASE || "https://api.sautikit.com";

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
};

export function isSautikitConfigured(): boolean {
  return Boolean(process.env.SAUTIKIT_API_KEY);
}

async function sautikitGet<T>(path: string): Promise<T> {
  const apiKey = process.env.SAUTIKIT_API_KEY;
  if (!apiKey) throw new Error("SAUTIKIT_API_KEY is not configured");

  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // Platform data changes rarely; avoid hammering the API on each render.
    next: { revalidate: 60 },
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
    if (status === 403) return null;
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
