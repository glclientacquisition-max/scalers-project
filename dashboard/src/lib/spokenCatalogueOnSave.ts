import "server-only";
import { after } from "next/server";
import { getVoicePublicBase } from "@/lib/sautikit";

/**
 * SPOKEN_CATALOGUE_ON_SAVE (default off, staging only). After an owner Save that
 * touched services / products / service areas / locations, ping Brain to
 * recompile the spoken catalogue. Runs after the response (never blocks Save);
 * Brain checks the catalogue hash and skips unchanged saves.
 */
export const SPOKEN_CATALOGUE_FIELDS = ["services_catalog", "product_catalog", "service_areas", "business_locations"] as const;

export function spokenCatalogueOnSaveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(String(env.SPOKEN_CATALOGUE_ON_SAVE || "").trim());
}

export function touchesSpokenCatalogue(patch: Record<string, unknown> | null | undefined): boolean {
  return Boolean(patch) && SPOKEN_CATALOGUE_FIELDS.some((k) => k in (patch as Record<string, unknown>));
}

export async function pingSpokenCatalogueCompile(tenantId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  if (!secret || !tenantId) return false;
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
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
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
