/**
 * Compat mirror: Service area picks (tenant_area_picks) -> the old coverage fields prod Voice reads.
 * Rule v1 agreed with Brain (27 Oct, /workspace/briefs/_relay/areas-picks-to-coverage-rule-v1.md) with Chief's
 * defaults on the open questions, plus Chief's lossless rule.
 *
 * Prod Voice (main) has no tenant_area_picks reader. It reads:
 *   - business_policies.coverage_areas: ["county:<name>" | "place:<name>"], names from
 *     kenyaPlaceCounties.json, max 40 (src/conversation/coverageAreas.js:17 parseCoverageAreas).
 *     A county id covers every place in that county; a place id covers that name only.
 *   - business_policies.coverage_outside: { anywhere_kenya: true, fee_ksh } (outsideAreas.js:24). The prompt prints
 *     the anywhere-Kenya line only next to a coverage_areas array (businessPolicies.js:104-121).
 *   - tenants.service_areas.areas[] terms when VOICE_AREA_FEES is on (areaTerms.js:60). Fee spoken only when
 *     source "owner" and confirmed true.
 *
 * Every Desk write to tenant_area_picks goes through lib/areaPicks.server.ts saveAreaPicks, which mirrors with
 * this function. tests/areaPicksToCoverageAreas.test.ts guards the mapping and the write path.
 *
 * Rule:
 *   1. Serving picks: "ke" -> coverage_outside {anywhere_kenya, fee}; county -> "county:<key>";
 *      town/estate -> "place:<name|alias>" the index knows (not a county name, prefers one filed under its county).
 *      A town named after its county (Kiambu, Kisii, Nakuru...) uses an index alias filed under that county
 *      ("kiambu cbd", "nakuru town"), never the whole county. Fee = resolved fee (own or serving ancestor):
 *      "fixed" when set, else "ask"; confirmed = picks confirmed. Modes/eta from the prior term. Notes not mirrored.
 *   2. Lossless (Chief): an id already in coverage_areas stays unless the owner removed it in this save (covered by
 *      the picks before, not now) or now explicitly excluded it. Kept ids go first so the cap never cuts them.
 *   3. D1 anchor when only "ke" serves and step 1+2 give no ids: ke row moved_from ids, then the business county
 *      (last resort), each only if the picks cover it; else [] (never null: null hides the outside line), `anchorless`.
 *      Home areas (anchor, or a kept id only ke covers) never take ke's fee: existing service_areas term unchanged,
 *      else the fee of the folded moved_from row (its confirmed flag), else fee_mode "ask", null, unconfirmed.
 *   4. D2 fail closed: serving picks exist but no ids and no anywhere-Kenya -> `failClosed`: the writer keeps the
 *      stale list, warns the owner and logs unmapped_all. Never "[]" without anywhere-Kenya while picks serve.
 *   5. D3 exclusions can't be expressed: the covering area stays listed (wrong yes), `lossy`, owner sees a banner.
 *   6. Unmapped nodes are left out (`unmapped`). Counties, then places; dedupe; cap 40 (`overflow`).
 *   7. No serving pick at all -> both keys removed ("not set").
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import INDEX from "./data/kenyaPlaceCounties.json" with { type: "json" };
import { areaNode, countyOf, moveOverAreas, normAreaText, resolveArea, ROOT_ID, type AreaPicks } from "./areaPicks.ts";

/** Same cap as prod Voice parseCoverageAreas (src/conversation/coverageAreas.js MAX_AREAS). */
export const COVERAGE_MIRROR_MAX = 40;

const COUNTIES = new Set<string>(INDEX.counties as string[]);
const PLACES = INDEX.places as Record<string, string[]>;
/** Index aliases for a county-named town, in order ("kiambu cbd", "nakuru town", "bungoma town centre", "kisumu central"). */
const COUNTY_TOWN_SUFFIXES = ["town", "cbd", "town centre", "central"] as const;

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
  /** Prior coverage ids dropped because the owner removed or excluded them. */
  dropped: string[];
  /** D1: ids added as the anchor for a ke-only business, and where from. */
  anchor: { ids: string[]; from: "moved_from" | "business_county" | "none" } | null;
  /** D1(d): ke-only with no anchor; coverage_areas is []. */
  anchorless: boolean;
  /** D2: serving picks map to nothing; do not write, keep the stale list, warn and log unmapped_all. */
  failClosed: boolean;
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
  const names = [n.name, ...n.aliases].map(normAreaText);
  const cands = names.filter((k) => k && !COUNTIES.has(k) && PLACES[k]);
  // A town named after its county: an index alias filed under that county ("kiambu cbd"), never the county.
  if (!cands.length && county && names.some((k) => COUNTIES.has(k))) {
    for (const suffix of COUNTY_TOWN_SUFFIXES) {
      const k = `${normAreaText(n.name)} ${suffix}`;
      if (PLACES[k]?.includes(county)) return k;
    }
  }
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
    /** tenant_area_picks.moved_from (D1 anchor b). */
    movedFrom?: string[] | null;
    /** Business county from its locations, tree id "county:<slug>" (D1 anchor c). */
    homeCounty?: string | null;
    /** confirmed_at was set on the picks before this save (fee of a folded moved_from row). */
    priorConfirmed?: boolean;
  } = {},
): CoverageMirror {
  const serving = picks.picks.filter((p) => p.serve);
  const out: CoverageMirror = {
    coverage_areas: null, coverage_outside: null, terms: [], unmapped: [], lossy: [], overflow: false,
    kept: [], dropped: [], anchor: null, anchorless: false, failClosed: false,
  };
  for (const p of picks.picks) {
    if (p.serve) continue;
    // An exclusion under a covered ancestor is still listed by the old shape (D3).
    const parent = areaNode(p.node)?.parent ?? null;
    if (parent && resolveArea(picks, parent).covered) out.lossy.push(p.node);
  }
  const prior = priorIds(opts.priorCoverage);
  // 7. No serving pick at all: "not set". Every prior id counts as removed by the owner.
  if (!serving.length) {
    out.dropped = prior;
    return out;
  }

  const nodeFor = new Map<string, string>();
  // 2. Lossless: prior ids stay unless removed or excluded by the owner in this save.
  const keptPrior: string[] = [];
  for (const id of prior) {
    const node = nodeForOldId(id);
    if (!node) {
      keptPrior.push(id);
      continue;
    }
    const now = resolveArea(picks, node);
    const before = opts.priorPicks ? resolveArea(opts.priorPicks, node).covered : true;
    const excluded = !now.covered && now.via != null;
    if (now.covered || (!before && !excluded)) {
      keptPrior.push(id);
      nodeFor.set(id, node);
    } else out.dropped.push(id);
  }

  // 1. Serving picks.
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
    if (!nodeFor.has(id)) nodeFor.set(id, p.node);
  }
  const fromPicks = new Set([...counties, ...places]);
  out.kept = keptPrior.filter((id) => !fromPicks.has(id));
  let ids = [...new Set([...keptPrior, ...counties, ...places])];

  // 3. D1: ke-only anchor.
  if (!ids.length && out.coverage_outside) {
    const covered = (oldId: string) => {
      const node = nodeForOldId(oldId);
      if (!node) return true; // ke covers every Kenyan place the tree can't name
      if (!resolveArea(picks, node).covered) return false;
      nodeFor.set(oldId, node);
      return true;
    };
    const moved = priorIds(opts.movedFrom).filter((id) => prodParses(id) && covered(id));
    const home = opts.homeCounty ? oldCoverageId(opts.homeCounty) : null;
    if (moved.length) out.anchor = { ids: moved, from: "moved_from" };
    else if (home && covered(home)) out.anchor = { ids: [home], from: "business_county" };
    else {
      out.anchor = { ids: [], from: "none" };
      out.anchorless = true;
    }
    ids = out.anchor.ids;
  }

  // 4. D2: serving picks that reach nothing.
  if (!ids.length && !out.coverage_outside) {
    out.failClosed = true;
    return out;
  }

  out.overflow = ids.length > COVERAGE_MIRROR_MAX;
  const kept = ids.slice(0, COVERAGE_MIRROR_MAX);
  out.coverage_areas = kept;
  const defaultMode = opts.vertical === "home_services" ? "visit" : "delivery";
  // Home areas (Brain, 27 Oct): an id that is only listed because anywhere in Kenya covers it (kept prior, or the D1
  // anchor) keeps its own fee and never takes ke's fee_ksh: its existing term as is, else the fee its folded
  // moved_from row had, else "ask".
  const homeIds = new Set(
    kept.filter((id) => {
      const node = nodeFor.get(id);
      return !node || resolveArea(picks, node).via === ROOT_ID;
    }),
  );
  const movedIds = new Set(out.anchor?.from === "moved_from" ? out.anchor.ids : []);
  out.terms = kept.map((id) => {
    const node = nodeFor.get(id);
    const priorTerm = existingTerm(opts.priorServiceAreas, id);
    const priorModes = Array.isArray(priorTerm?.modes) ? (priorTerm!.modes as unknown[]).map(String).filter((m) => MODES.has(m)) : [];
    const modes = (priorModes.length ? priorModes : [defaultMode]) as MirrorAreaTerm["modes"];
    const eta = typeof priorTerm?.eta === "string" && priorTerm.eta.trim() ? priorTerm.eta.trim() : null;
    if (homeIds.has(id)) {
      if (priorTerm) return { ...(priorTerm as MirrorAreaTerm), id };
      const folded = node && movedIds.has(id) ? opts.priorPicks?.picks.find((p) => p.node === node && p.serve) : null;
      if (folded && folded.fee_kes != null) {
        return { id, modes, fee_mode: "fixed", fee_ksh: folded.fee_kes, eta, source: "owner", confirmed: opts.priorConfirmed === true };
      }
      return { id, modes, fee_mode: "ask", fee_ksh: null, eta, source: "owner", confirmed: false };
    }
    const fee = node ? resolveArea(picks, node).fee_kes : null;
    return {
      id,
      modes,
      fee_mode: fee != null ? "fixed" : "ask",
      fee_ksh: fee,
      eta,
      source: "owner",
      confirmed: opts.confirmed === true,
    };
  });
  return out;
}

/** Same acceptance as prod parseCoverageAreas for one id. */
function prodParses(id: string): boolean {
  const split = id.indexOf(":");
  const kind = id.slice(0, split);
  const name = id.slice(split + 1);
  if (kind === "county") return COUNTIES.has(name);
  if (kind === "place") return Boolean(PLACES[name]) && !COUNTIES.has(name);
  return false;
}

/** Owner-facing notes for the line the phone reads (D2/D3 banner). Names, not ids. */
export function areaLineNotes(picks: AreaPicks): { yesStill: string[]; notOnLine: string[]; nothingReaches: boolean } {
  const m = areaPicksToCoverageAreas(picks);
  const name = (id: string) => areaNode(id)?.name ?? id;
  return { yesStill: m.lossy.map(name), notOnLine: m.unmapped.map(name), nothingReaches: m.failClosed };
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
