/**
 * Compat mirror: Service area picks (tenant_area_picks) -> the old coverage fields prod Voice reads.
 *
 * Prod Voice (main) has no tenant_area_picks reader. It reads:
 *   - business_policies.coverage_areas: ["county:<name>" | "place:<name>"], names from
 *     kenyaPlaceCounties.json, max 40 (src/conversation/coverageAreas.js parseCoverageAreas).
 *     A county id covers every place in that county; a place id covers that name only.
 *   - business_policies.coverage_outside: { anywhere_kenya: true, fee_ksh } (src/conversation/outsideAreas.js).
 *   - tenants.service_areas.areas[] terms (fee per listed id) when VOICE_AREA_FEES is on (src/conversation/areaTerms.js).
 *     A fee is spoken only when source "owner" and confirmed true.
 *
 * Every Desk write to tenant_area_picks must also write the result of this function
 * (lib/areaPicks.server.ts saveAreaPicks). tests/areaPicksToCoverageAreas.test.ts guards both.
 *
 * Mapping rules (the old shape has no exclusions and no notes):
 *   - Serving pick on "ke" -> coverage_outside { anywhere_kenya: true, fee_ksh: its fee }.
 *   - Serving pick on a county -> "county:<name>".
 *   - Serving pick on a town or estate -> "place:<name>" (name or alias that the place index puts in that county).
 *   - Exclusions (serve false) cannot be expressed: the covering county or "anywhere in Kenya" still lists them.
 *     They are returned in `lossy` so callers and reviewers can see them.
 *   - Nodes the old index cannot name (Wajir, Mandera, Trans Nzoia, county-named towns like Kisumu town)
 *     are left out and returned in `unmapped`.
 *   - Fee: the resolved fee for that node (own pick or serving ancestor). Fee set -> fee_mode "fixed";
 *     no fee -> "ask" (team confirms). Notes are not mirrored.
 *   - No serving pick at all -> coverage_areas null (key removed): "not set", never "serves nowhere".
 *   - Lossless (Chief, 27 Oct): an id already in coverage_areas is never dropped by a save unless the owner
 *     removed it. Removed = the picks before this save covered it and the new picks do not. Kept ids come
 *     first so the 40 cap never cuts them. Ids the tree cannot place are always kept. This is what keeps a
 *     backfilled "ke"-only tenant's named home area (["county:nairobi"] + anywhere in Kenya).
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import INDEX from "./data/kenyaPlaceCounties.json" with { type: "json" };
import { areaNode, countyOf, moveOverAreas, normAreaText, resolveArea, ROOT_ID, type AreaPicks } from "./areaPicks.ts";

/** Same cap as prod Voice parseCoverageAreas (src/conversation/coverageAreas.js MAX_AREAS). */
export const COVERAGE_MIRROR_MAX = 40;

const COUNTIES = new Set<string>(INDEX.counties as string[]);
const PLACES = INDEX.places as Record<string, string[]>;

export type MirrorAreaTerm = {
  id: string;
  modes: Array<"delivery" | "visit" | "pickup">;
  fee_mode: "fixed" | "ask";
  fee_ksh: number | null;
  eta: string | null;
  source: "owner";
  confirmed: boolean;
};

export type CoverageMirror = {
  /** null: no serving pick, remove the key. */
  coverage_areas: string[] | null;
  coverage_outside: { anywhere_kenya: true; fee_ksh: number | null } | null;
  /** service_areas.areas terms, one per coverage id. */
  terms: MirrorAreaTerm[];
  /** Picks with no old id. */
  unmapped: string[];
  /** Exclusions the old shape still lists as covered. */
  lossy: string[];
  /** More than COVERAGE_MIRROR_MAX ids; the rest were dropped. */
  overflow: boolean;
  /** Prior coverage ids kept that no serving pick names directly (lossless rule). */
  kept: string[];
  /** Prior coverage ids dropped because the owner removed them (covered before this save, not now). */
  dropped: string[];
};

/** Old county key for a tree county node ("county:muranga" -> "muranga"), or null. */
export function oldCountyKey(nodeId: string): string | null {
  const n = areaNode(nodeId);
  if (!n || n.kind !== "county") return null;
  for (const cand of [normAreaText(n.name), n.id.slice("county:".length).replace(/-/g, " ")]) {
    if (COUNTIES.has(cand)) return cand;
  }
  return null;
}

/** Old place key for a tree town/estate node, or null. Must not be a county name; prefers names in its county. */
export function oldPlaceKey(nodeId: string): string | null {
  const n = areaNode(nodeId);
  if (!n || (n.kind !== "town" && n.kind !== "estate")) return null;
  const c = countyOf(nodeId);
  const county = c ? oldCountyKey(c.id) : null;
  const cands = [n.name, ...n.aliases].map(normAreaText).filter((k) => k && !COUNTIES.has(k) && PLACES[k]);
  // A place id covers that name only, so a name the index files under another county is still exact.
  return cands.find((k) => county && PLACES[k].includes(county)) ?? cands[0] ?? null;
}

/** Old coverage id for a tree node, or null. */
export function oldCoverageId(nodeId: string): string | null {
  const county = oldCountyKey(nodeId);
  if (county) return `county:${county}`;
  const place = oldPlaceKey(nodeId);
  return place ? `place:${place}` : null;
}

/** Tree node for an old coverage id, only on an exact name or alias match (never a fuzzy guess). */
export function nodeForOldId(oldId: string): string | null {
  const raw = String(oldId || "").trim().toLowerCase();
  const split = raw.indexOf(":");
  if (split < 1) return null;
  const name = normAreaText(raw.slice(split + 1));
  const node = moveOverAreas([raw]).rows[0]?.node ?? null;
  const n = node ? areaNode(node) : null;
  if (!n || n.kind === "country") return null;
  if (raw.startsWith("county:") && n.kind !== "county") return null;
  const names = [n.name, ...n.aliases].map(normAreaText);
  return names.includes(name) ? n.id : null;
}

function priorIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (/^(county|place):./.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function existingTerm(prior: unknown, id: string): { modes?: unknown; eta?: unknown } | null {
  const areas = prior && typeof prior === "object" ? (prior as { areas?: unknown }).areas : null;
  if (!Array.isArray(areas)) return null;
  return (areas.find((a) => a && typeof a === "object" && (a as { id?: unknown }).id === id) as { modes?: unknown; eta?: unknown }) ?? null;
}

const MODES = new Set(["delivery", "visit", "pickup"]);

/**
 * picks -> old coverage fields. `confirmed`: tenant_area_picks.confirmed_at is set.
 * `priorServiceAreas`: current tenants.service_areas (keeps modes / eta per id). `vertical` picks the default mode.
 */
export function areaPicksToCoverageAreas(
  picks: AreaPicks,
  opts: {
    confirmed?: boolean;
    vertical?: string | null;
    priorServiceAreas?: unknown;
    /** business_policies.coverage_areas before this save. */
    priorCoverage?: unknown;
    /** Picks before this save (the stored row, or what the page showed). null: none. */
    priorPicks?: AreaPicks | null;
  } = {},
): CoverageMirror {
  const serving = picks.picks.filter((p) => p.serve);
  const out: CoverageMirror = { coverage_areas: null, coverage_outside: null, terms: [], unmapped: [], lossy: [], overflow: false, kept: [], dropped: [] };
  for (const p of picks.picks) {
    if (p.serve) continue;
    // An exclusion under any covered ancestor is still listed by the old shape.
    const n = areaNode(p.node);
    const parent = n?.parent ?? null;
    if (parent && resolveArea(picks, parent).covered) out.lossy.push(p.node);
  }
  // Lossless: prior ids stay unless the owner removed them in this save.
  const keptPrior: string[] = [];
  const priorNode = new Map<string, string>();
  for (const id of priorIds(opts.priorCoverage)) {
    const node = nodeForOldId(id);
    if (!node) {
      keptPrior.push(id);
      continue;
    }
    priorNode.set(id, node);
    const now = resolveArea(picks, node).covered;
    const before = opts.priorPicks ? resolveArea(opts.priorPicks, node).covered : true;
    if (now || !before) keptPrior.push(id);
    else out.dropped.push(id);
  }
  if (!serving.length && !keptPrior.length) return out;

  const defaultMode = opts.vertical === "home_services" ? "visit" : "delivery";
  const counties: string[] = [];
  const places: string[] = [];
  for (const p of serving) {
    if (p.node === ROOT_ID) {
      out.coverage_outside = { anywhere_kenya: true, fee_ksh: p.fee_kes };
      continue;
    }
    const id = oldCoverageId(p.node);
    if (!id) {
      out.unmapped.push(p.node);
      continue;
    }
    (id.startsWith("county:") ? counties : places).push(id);
  }
  // Kept prior ids first (never cut by the cap), then counties (widest cover), then places.
  const fromPicks = new Set([...counties, ...places]);
  out.kept = keptPrior.filter((id) => !fromPicks.has(id));
  const ids = [...new Set([...keptPrior, ...counties, ...places])];
  out.overflow = ids.length > COVERAGE_MIRROR_MAX;
  const kept = ids.slice(0, COVERAGE_MIRROR_MAX);
  out.coverage_areas = kept;
  const nodeFor = new Map<string, string>();
  for (const p of serving) {
    const id = p.node === ROOT_ID ? null : oldCoverageId(p.node);
    if (id && !nodeFor.has(id)) nodeFor.set(id, p.node);
  }
  for (const [id, node] of priorNode) if (!nodeFor.has(id)) nodeFor.set(id, node);
  out.terms = kept.map((id) => {
    const node = nodeFor.get(id);
    const prior = existingTerm(opts.priorServiceAreas, id);
    if (!node && prior) return { ...(prior as MirrorAreaTerm), id };
    const fee = node ? resolveArea(picks, node).fee_kes : null;
    const priorModes = Array.isArray(prior?.modes) ? (prior!.modes as unknown[]).map(String).filter((m) => MODES.has(m)) : [];
    const eta = typeof prior?.eta === "string" && prior.eta.trim() ? prior.eta.trim() : null;
    return {
      id,
      modes: (priorModes.length ? priorModes : [defaultMode]) as MirrorAreaTerm["modes"],
      fee_mode: fee != null ? "fixed" : "ask",
      fee_ksh: fee,
      eta,
      source: "owner",
      confirmed: opts.confirmed === true,
    };
  });
  return out;
}

/** business_policies with the mirror applied. Other keys untouched. */
export function applyCoverageMirrorToPolicies(policies: unknown, m: CoverageMirror): Record<string, unknown> {
  const base = policies && typeof policies === "object" && !Array.isArray(policies) ? { ...(policies as Record<string, unknown>) } : {};
  if (m.coverage_areas) base.coverage_areas = m.coverage_areas;
  else delete base.coverage_areas;
  if (m.coverage_outside) base.coverage_outside = m.coverage_outside;
  else delete base.coverage_outside;
  return base;
}

/** tenants.service_areas with the mirror applied (areas, anywhere_kenya, outside_fee_ksh). Other keys untouched. */
export function applyCoverageMirrorToServiceAreas(serviceAreas: unknown, m: CoverageMirror): Record<string, unknown> {
  const base: Record<string, unknown> =
    serviceAreas && typeof serviceAreas === "object" && !Array.isArray(serviceAreas) ? { ...(serviceAreas as Record<string, unknown>) } : { version: 1 };
  base.areas = m.terms;
  base.anywhere_kenya = Boolean(m.coverage_outside);
  base.outside_fee_ksh = m.coverage_outside?.fee_ksh ?? null;
  return base;
}
