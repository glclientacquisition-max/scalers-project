import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getVoicePublicBase } from "@/lib/voicePublicBase.js";
import type { KbCategory, KbItem, KbReadiness, KbSnapshotRow } from "@/lib/kbCore";

export type KbState = {
  ok: true;
  items: KbItem[];
  categories: KbCategory[];
  live: KbSnapshotRow | null;
  latest: KbSnapshotRow | null;
  readiness: KbReadiness;
  liveVersion: number | null;
  readyVersion: number | null;
  brainTarget: "v1" | "v2";
} | { ok: false; reason: "no_tables" | "error" };

const ITEM_COLS =
  "id, kind, name_en, name_sw, name_sw_state, name_sw_suggested, aliases, category_id, description_en, unit, price_mode, price_amount, price_min, price_max, in_stock, popular, delivery_fee_kes, status, sort, source, legacy_ref, row_version";

const n = (v: unknown) => (v == null ? null : Number(v));

/** Everything the Knowledge page shows. Service role after the member check in the caller. */
export async function loadKbState(tenantId: string): Promise<KbState> {
  const sb = getSupabaseAdmin();
  const [items, cats, snaps, ready, tenant] = await Promise.all([
    sb.from("kb_items").select(ITEM_COLS).eq("tenant_id", tenantId).neq("status", "hidden").order("sort").limit(20000),
    sb.from("kb_categories").select("id, name_en, name_sw, name_sw_state, sort").eq("tenant_id", tenantId).order("sort"),
    sb.from("kb_snapshots").select("version, status, issues, item_count, compiled_at").eq("tenant_id", tenantId).order("version", { ascending: false }).limit(5),
    sb.from("kb_readiness").select("snapshot_version, passed, checks, tests, checked_at").eq("tenant_id", tenantId).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("tenants").select("kb_live_version, kb_ready_version, brain_target").eq("id", tenantId).maybeSingle(),
  ]);
  const err = items.error || cats.error || snaps.error || ready.error || tenant.error;
  if (err) {
    const missing = /kb_items|kb_categories|kb_snapshots|kb_readiness|kb_live_version|does not exist|schema cache/i.test(err.message || "");
    return { ok: false, reason: missing ? "no_tables" : "error" };
  }
  const rows = (snaps.data || []) as KbSnapshotRow[];
  const liveV = n(tenant.data?.kb_live_version);
  let live = rows.find((r) => r.version === liveV) || null;
  if (liveV != null) {
    const doc = await sb.from("kb_snapshots").select("doc->preview").eq("tenant_id", tenantId).eq("version", liveV).maybeSingle();
    const preview = (doc.data as { preview?: unknown } | null)?.preview;
    if (live) live = { ...live, doc: { preview: Array.isArray(preview) ? (preview as never) : [] } };
  }
  const items2 = ((items.data || []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as KbItem),
    price_amount: n(r.price_amount),
    price_min: n(r.price_min),
    price_max: n(r.price_max),
    aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
  }));
  return {
    ok: true,
    items: items2,
    categories: (cats.data || []) as KbCategory[],
    live,
    latest: rows[0] || null,
    readiness: (ready.data as KbReadiness) || null,
    liveVersion: liveV,
    readyVersion: n(tenant.data?.kb_ready_version),
    brainTarget: tenant.data?.brain_target === "v1" ? "v1" : "v2",
  };
}

/** Ask Voice to compile kb_items into a new snapshot and re-check readiness. Fire and forget (3 s cap). */
export async function pingKbCompile(tenantId: string, body: Record<string, unknown> = {}, path = "/internal/kb/compile"): Promise<{ ok: boolean; status?: number; json?: unknown }> {
  const secret = String(process.env.VOICE_INTERNAL_SECRET || "").trim();
  if (!secret) {
    console.warn(`[kb] ping skipped tenant=${tenantId}: VOICE_INTERNAL_SECRET unset`);
    return { ok: false };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), path.endsWith("readiness") ? 25000 : 3000);
  try {
    const res = await fetch(new URL(path, `${getVoicePublicBase()}/`).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voice-internal-secret": secret },
      body: JSON.stringify({ tenantId, ...body }),
      cache: "no-store",
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) console.warn(`[kb] ping ${path} tenant=${tenantId} status=${res.status}`);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    console.warn(`[kb] ping ${path} tenant=${tenantId}: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}
