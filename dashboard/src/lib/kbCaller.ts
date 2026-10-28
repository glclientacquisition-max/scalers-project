/**
 * What a caller-facing reader sees for a business whose KB is live on calls (pure; no server imports, no env).
 * Desk twin of the KB mode in Voice src/knowledge/kb/source.js + kb/live.attach, so the "What it will say" page,
 * the lookup preview and the Test greeting preview say what the call would say:
 *  - KB live (isKbLive): only offered (active) items are listed; paused / not offered / hidden never are; the old
 *    free-text services line (services_offered, a derived copy) is never read, so notes are empty; the greeting
 *    names groups (categories), never single items, and only when there is more than one group.
 *  - Not live (gate off, readiness not passed, no snapshot, prod today): the legacy reads, unchanged.
 */
import { mirrorLegacy, type KbCategory, type KbItem } from "./kbCore";

/**
 * Inputs for isKbLive. The server passes them in (kbCaller.server.ts); this file never reads env.
 *  gate: BRAIN_KB_GATE on (Voice live.gateOn rule). Default off.
 *  liveVersion: tenants.kb_live_version. brainTarget: tenants.brain_target ('v2' default).
 *  readinessPassed: a kb_readiness row passed for liveVersion (the pass that moves tenants.kb_ready_version).
 *  snapshot: the kb_snapshots row for liveVersion exists (Voice attaches only with a snapshot doc).
 */
export type KbLiveInput = {
  gate?: boolean;
  liveVersion?: number | null;
  brainTarget?: string | null;
  readinessPassed?: boolean;
  snapshot?: boolean;
};

/** The one predicate: Voice reads the KB on this business's calls (live.attach with the gate on and ready). */
export function isKbLive(x: KbLiveInput | null | undefined): boolean {
  if (!x || x.gate !== true) return false;
  if (x.liveVersion == null || !Number.isFinite(Number(x.liveVersion))) return false;
  if (String(x.brainTarget || "v2") !== "v2") return false;
  return x.readinessPassed === true && x.snapshot === true;
}

const OFF = new Set(["paused", "not_offered", "hidden"]);

/** Offered items in the compile's order (sort, then id). */
export function offeredKbItems(items: readonly KbItem[]): KbItem[] {
  return items
    .filter((x) => x && !OFF.has(x.status) && String(x.name_en || "").trim())
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)));
}

function joinList(xs: string[]): string {
  return xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Group names a caller hears, compile order (first offered item of each group), named groups only. */
export function kbGroupNames(items: readonly KbItem[], categories: readonly KbCategory[]): string[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const order: string[] = [];
  for (const it of offeredKbItems(items)) {
    const id = it.category_id || "_other";
    if (!order.includes(id)) order.push(id);
  }
  return order
    .map((id) => (cats.get(id)?.name_en || (id === "_other" ? "" : id)).trim().toLowerCase())
    .filter(Boolean);
}

/** Twin of source.js openerLine('en'): "We help with a, b and c." for two or more groups, else "". */
export function kbOpenerLine(items: readonly KbItem[], categories: readonly KbCategory[]): string {
  const names = kbGroupNames(items, categories);
  return names.length > 1 ? `We help with ${joinList(names.slice(0, 3))}.` : "";
}

type CatalogueRow = { services_catalog?: unknown; product_catalog?: unknown; services_offered?: string | null };

/**
 * The tenant row a caller-facing reader gets when the KB is live: catalogue columns hold offered items only and
 * services_offered is null (Voice attach sets servicesOffered null). Not live: unchanged.
 */
export function kbCallerRow<T extends CatalogueRow>(tenant: T, items: readonly KbItem[] | null, categories: readonly KbCategory[], live: boolean): T {
  if (!live || !items) return tenant;
  const m = mirrorLegacy(offeredKbItems(items), [...categories], {
    services_catalog: tenant.services_catalog ?? [],
    product_catalog: tenant.product_catalog ?? [],
  });
  return { ...tenant, services_catalog: m.services_catalog, product_catalog: m.product_catalog, services_offered: null };
}

/** Desk fact profile when the KB is live: the speech fact sheet (provenance.ts) then leaves notes empty, like Voice. */
export function kbFactProfile<P extends Record<string, unknown>>(profile: P, live: boolean): P & { kbMode?: true } {
  return live ? { ...profile, kbMode: true as const, servicesOffered: null } : profile;
}
