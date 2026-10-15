import "server-only";

import { requireSuperAdmin } from "@/lib/adminGuard";
import { listDidPool } from "@/lib/didPool";
import { fetchVoiceAdminHealth } from "@/lib/platformVoiceHealth";
import {
  PINNED_DID,
  answeredPct,
  buildProviderCards,
  type CallStats,
  type PinnedLine,
  type ProviderCard,
} from "@/lib/providerHealthModel";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Calls in the last 1h and 24h, answered % = not abandoned. Reads only. */
export async function loadCallStats(now: Date = new Date()): Promise<CallStats | null> {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();
  const since = (ms: number) => new Date(now.getTime() - ms).toISOString();
  async function count(sinceIso: string, resolution?: string): Promise<number> {
    let q = admin.from("calls").select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
    if (resolution) q = q.eq("resolution", resolution);
    const { count: n, error } = await q;
    if (error) throw error;
    return n || 0;
  }
  try {
    const [lastHour, lastDay] = await Promise.all([count(since(3_600_000)), count(since(86_400_000))]);
    let abandoned: number | null = null;
    try {
      abandoned = await count(since(86_400_000), "abandoned");
    } catch {
      abandoned = null;
    }
    return { lastHour, lastDay, answeredPct: answeredPct(lastDay, abandoned) };
  } catch (err) {
    console.error("[admin:platform] call stats", err instanceof Error ? err.message : err);
    return null;
  }
}

export type LineRow = { e164: string; business: string | null; status: string; pinned: boolean };

/** DID → business from sautikit_did_pool, Aris line pinned first. */
export async function loadLines(): Promise<{ rows: LineRow[]; pinned: PinnedLine | null } | null> {
  await requireSuperAdmin();
  try {
    const pool = await listDidPool();
    const rows: LineRow[] = pool
      .map((r) => ({
        e164: r.e164,
        business: r.tenants?.business_name ?? null,
        status: r.status,
        pinned: r.e164 === PINNED_DID,
      }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const hit = rows.find((r) => r.pinned);
    const pinned: PinnedLine = hit
      ? { e164: hit.e164, business: hit.business, status: hit.status }
      : { e164: PINNED_DID, business: null, status: null };
    return { rows, pinned };
  } catch (err) {
    console.error("[admin:platform] lines", err instanceof Error ? err.message : err);
    return null;
  }
}

export type PlatformHealth = {
  checkedAt: string;
  prod: ProviderCard[];
  staging: ProviderCard[];
  prodGit: { sha: string | null; startedAt: string | null };
  stagingGit: { sha: string | null; startedAt: string | null };
};

/** Both Voice environments in parallel. Supabase reachability feeds the prod card. */
export async function loadPlatformHealth(supabaseOk: boolean | null): Promise<PlatformHealth> {
  await requireSuperAdmin();
  const [prod, staging] = await Promise.all([fetchVoiceAdminHealth("prod"), fetchVoiceAdminHealth("staging")]);
  const git = (f: typeof prod) =>
    f.status === "ok"
      ? { sha: (f.payload as { gitSha?: string | null }).gitSha ?? null, startedAt: f.payload.startedAt ?? null }
      : { sha: null, startedAt: null };
  return {
    checkedAt: new Date().toISOString(),
    prod: buildProviderCards("prod", prod, { supabaseOk }),
    staging: buildProviderCards("staging", staging),
    prodGit: git(prod),
    stagingGit: git(staging),
  };
}
