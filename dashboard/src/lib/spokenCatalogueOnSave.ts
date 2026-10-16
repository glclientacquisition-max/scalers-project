import "server-only";
import { after } from "next/server.js";
import { getVoicePublicBase } from "./voicePublicBase.js";

/**
 * SPOKEN_CATALOGUE_ON_SAVE (default off, staging only). After an owner Save that
 * touched services / products / service areas / locations, ping Brain to
 * recompile the spoken catalogue. Runs after the response (never blocks Save);
 * Brain checks the catalogue hash and skips unchanged saves.
 */
// service_areas carries the Locations areas and delivery fees (#667, outside-area fee #672);
// business_policies carries their mirror (coverage_areas / coverage_outside) the voice server reads.
export const SPOKEN_CATALOGUE_FIELDS = ["services_catalog", "product_catalog", "service_areas", "business_locations", "business_policies"] as const;

export function spokenCatalogueOnSaveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(String(env.SPOKEN_CATALOGUE_ON_SAVE || "").trim());
}

export function touchesSpokenCatalogue(patch: Record<string, unknown> | null | undefined): boolean {
  return Boolean(patch) && SPOKEN_CATALOGUE_FIELDS.some((k) => k in (patch as Record<string, unknown>));
}

// One retry after a short pause on a network error, timeout or 5xx (Brain redeploying);
// a 4xx is a real refusal and is not retried. If both fail, the call path still never
// speaks a stale price: Brain refreshes changed rows from the live catalogue at call start.
async function pingOnce(tenantId: string, secret: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; retry: boolean; why: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    const url = new URL("/internal/desk/spoken-catalogue", `${getVoicePublicBase()}/`).toString();
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voice-internal-secret": secret },
      body: JSON.stringify({ tenantId }),
      cache: "no-store",
      signal: ctl.signal,
    });
    return { ok: res.ok, retry: !res.ok && res.status >= 500, why: `status=${res.status}` };
  } catch (err) {
    return { ok: false, retry: true, why: err instanceof Error ? err.name : "error" };
  } finally {
    clearTimeout(t);
  }
}

export async function pingSpokenCatalogueCompile(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
  { retryDelayMs = 1500 }: { retryDelayMs?: number } = {},
): Promise<boolean> {
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  if (!secret || !tenantId) {
    console.warn(`[spoken_catalogue] ping skipped tenant=${tenantId || "-"}: ${secret ? "no tenant" : "VOICE_INTERNAL_SECRET unset"}`);
    return false;
  }
  let r = await pingOnce(tenantId, secret, fetchImpl);
  if (!r.ok && r.retry) {
    if (retryDelayMs > 0) await new Promise((res) => setTimeout(res, retryDelayMs));
    r = await pingOnce(tenantId, secret, fetchImpl);
  }
  if (!r.ok) console.warn(`[spoken_catalogue] ping failed tenant=${tenantId} ${r.why}`);
  return r.ok;
}

/** Call right after the tenants update succeeded. No-op when the flag is off or the patch is unrelated. */
export function requestSpokenCatalogueCompile(tenantId: string, patch?: Record<string, unknown> | null): void {
  if (!spokenCatalogueOnSaveEnabled()) return;
  if (patch !== undefined && !touchesSpokenCatalogue(patch)) return;
  try {
    after(() => pingSpokenCatalogueCompile(tenantId).then(() => undefined));
  } catch {
    void pingSpokenCatalogueCompile(tenantId);
  }
}
