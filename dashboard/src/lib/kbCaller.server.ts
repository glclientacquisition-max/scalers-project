import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { KbCategory } from "@/lib/kbCore";
import { isKbLive, kbCallerRow, type KbLiveInput } from "@/lib/kbCaller";
import { loadKbItems } from "@/lib/kbWrite.server";
import { createWorkspaceDataClient } from "@/lib/tenant";

/**
 * BRAIN_KB_GATE, same name and rule as Voice src/knowledge/kb/live.js gateOn (1, true, on, yes). Server only;
 * unset = off, so Desk keeps the legacy reads. Set it on Desk wherever it is set on Voice.
 */
export function brainKbGateFromEnv(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.BRAIN_KB_GATE || "").trim());
}

/**
 * The isKbLive inputs for one business, read with the signed-in member's session (RLS: tenants, kb_readiness and
 * kb_snapshots are member-readable). Any read error (no KB columns or tables, prod today) reads as not live.
 */
export const loadKbLiveInput = cache(async (tenantId: string, gate: boolean = brainKbGateFromEnv()): Promise<KbLiveInput> => {
  if (!gate || !tenantId) return { gate };
  try {
    const ws = await createWorkspaceDataClient();
    if (!ws) return { gate };
    const t = await ws.client.from("tenants").select("kb_live_version, brain_target").eq("id", tenantId).maybeSingle();
    const row = t.data as { kb_live_version: number | null; brain_target: string | null } | null;
    if (t.error || !row || row.kb_live_version == null) return { gate, liveVersion: null };
    const live = row.kb_live_version;
    const [ready, snap] = await Promise.all([
      ws.client.from("kb_readiness").select("id").eq("tenant_id", tenantId).eq("snapshot_version", live).eq("passed", true).limit(1),
      ws.client.from("kb_snapshots").select("version").eq("tenant_id", tenantId).eq("version", live).limit(1),
    ]);
    return {
      gate,
      liveVersion: live,
      brainTarget: row.brain_target,
      readinessPassed: !ready.error && (ready.data || []).length > 0,
      snapshot: !snap.error && (snap.data || []).length > 0,
    };
  } catch {
    return { gate };
  }
});

/** isKbLive for one business (server). */
export async function loadKbLive(tenantId: string): Promise<boolean> {
  return isKbLive(await loadKbLiveInput(tenantId));
}

const PROJECTED = new WeakSet<object>();

/**
 * The tenant row as a caller-facing reader sees it (kbCaller.ts): KB live = offered items only and no old services
 * text. Not live: the stored row, unchanged. Callers authorize first; items are read with the service role.
 * Safe to call twice on the same row.
 */
export async function loadKbCallerRow<T extends { id: string; services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null }>(tenant: T): Promise<T> {
  if (PROJECTED.has(tenant)) return tenant;
  try {
    if (!(await loadKbLive(tenant.id))) return tenant;
    const [items, cats] = await Promise.all([
      loadKbItems(tenant.id),
      getSupabaseAdmin().from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenant.id),
    ]);
    if (!items || cats.error) return tenant;
    const row = kbCallerRow(tenant, items, (cats.data || []) as KbCategory[], true);
    PROJECTED.add(row);
    return row;
  } catch {
    return tenant;
  }
}
