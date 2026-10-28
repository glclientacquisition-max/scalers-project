import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import { kbChangesPending, kbSnapshotAttachArgs, type KbLiveSnapshot } from "@/lib/kbCaller";
import { loadKbLive, type KbLiveReason } from "@/lib/kbLive.server";
import { requireVoice } from "@/lib/voiceRequire.server";

export type { KbLiveSnapshot };

/**
 * One preview decision per request. `live`/`reason` come straight from the shared isKbLive (kbLive.server), never
 * recomputed here. When live, the snapshot for kb_live_version is read; if that read fails the preview falls back to
 * the legacy reads and the failure is logged (the decision itself is not changed). `pending`: kb_items changed after
 * the snapshot compiled. Service role: call only after the member check in the caller.
 */
export const loadKbPreview = cache(async (tenantId: string): Promise<{
  live: boolean;
  reason: KbLiveReason;
  snapshot: KbLiveSnapshot | null;
  pending: boolean;
}> => {
  const d = await loadKbLive(tenantId);
  const version = d.facts?.kb_live_version ?? null;
  if (!d.live || version == null) return { live: d.live, reason: d.reason, snapshot: null, pending: false };
  try {
    const sb = getSupabaseAdmin();
    const [snap, newest] = await Promise.all([
      sb.from("kb_snapshots").select("version, doc, bytes, compiled_at").eq("tenant_id", tenantId).eq("version", version).maybeSingle(),
      sb.from("kb_items").select("updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const row = snap.data as { version: number; doc: { items?: unknown[] } | null; bytes: number | null; compiled_at: string | null } | null;
    if (snap.error || !row || !row.doc || !Array.isArray(row.doc.items)) {
      console.warn("[kbPreview] live snapshot unreadable, preview uses legacy reads", { version, error: snap.error?.message || (row ? "no doc" : "no row") });
      return { live: d.live, reason: d.reason, snapshot: null, pending: false };
    }
    const latest = (newest.data as { updated_at?: string } | null)?.updated_at ?? null;
    return {
      live: d.live,
      reason: d.reason,
      snapshot: { version: Number(row.version), brainTarget: d.facts?.brain_target || "v2", doc: row.doc, bytes: row.bytes ?? null, compiledAt: row.compiled_at },
      pending: kbChangesPending(latest, row.compiled_at),
    };
  } catch (err) {
    console.warn("[kbPreview] live snapshot read failed, preview uses legacy reads", { version, error: (err as Error)?.message });
    return { live: d.live, reason: d.reason, snapshot: null, pending: false };
  }
});

type LiveModule = { attach: (profile: unknown, kb: unknown, opts: { force?: boolean }) => unknown };
type SourceModule = { catalogueSource: (profile: unknown) => { mode: string; openerLine: (lang?: string) => string | null } };

/**
 * Put the snapshot on a Voice profile exactly as a call does (Voice's own kb/live.attach, so every Voice reader on
 * the Desk server, kb/source.js included, reads it: offered items only, no old services text). The decision was
 * already taken by isKbLive, so attach is forced. No snapshot: the profile is left as is (legacy).
 */
export function attachKbSnapshot<P extends object>(profile: P, snapshot: KbLiveSnapshot | null): P {
  if (!snapshot) return profile;
  const [info, opts] = kbSnapshotAttachArgs(snapshot);
  requireVoice<LiveModule>("./src/knowledge/kb/live.js").attach(profile, info, opts);
  return profile;
}

/** The greeting offering line the call builds from the snapshot (source.js openerLine), "" when it names no groups. */
export function kbOpeningLine(profile: unknown): string {
  return requireVoice<SourceModule>("./src/knowledge/kb/source.js").catalogueSource(profile).openerLine("en") || "";
}

/**
 * Test greeting preview inputs: when live with a snapshot, the offering line from that snapshot and whether newer
 * saves are still on their way; otherwise null (TestLinePanel keeps the legacy reads).
 */
export async function loadKbGreetingPreview(tenant: { id: string } & Record<string, unknown>): Promise<{ offeringLine: string; pending: boolean } | null> {
  const p = await loadKbPreview(tenant.id);
  if (!p.snapshot) return null;
  const { tenantProfileFromRow } = requireVoice<{ tenantProfileFromRow: (row: unknown, extras: unknown) => object }>("./src/tenantProfile.js");
  const profile = attachKbSnapshot(tenantProfileFromRow(tenant, {}), p.snapshot);
  return { offeringLine: kbOpeningLine(profile), pending: p.pending };
}
