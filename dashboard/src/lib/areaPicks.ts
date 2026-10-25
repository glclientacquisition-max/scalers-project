/**
 * Owner service-area picks on the versioned Kenya area tree (Settings › Service areas).
 *
 * Contract (shared with Brain's KB check, see docs/reference/platform/AREA_PICKS.md):
 * - Stored in public.tenant_area_picks.picks as { version: 1, tree_version, picks: AreaPick[] }.
 * - A pick is an include (serve: true) or exclude (serve: false) on any node: country, county, town or estate.
 * - Coverage of a node = the nearest pick on it or an ancestor. No pick anywhere = not covered.
 * - Fee and note come from the nearest serving pick that sets them.
 *
 * Pure and browser-safe. Relative imports only so node tests can load it.
 */
import TREE from "./data/kenyaAreaTree.v1.json" with { type: "json" };

export type AreaKind = "country" | "county" | "town" | "estate";
export type AreaNode = {
  id: string;
  name: string;
  kind: AreaKind;
  parent: string | null;
  aliases: string[];
  landmarks: string[];
};
export type AreaPick = {
  node: string;
  serve: boolean;
  /** Extra travel fee in whole KES on top of the job price. null = none. */
  fee_kes: number | null;
  /** Short caller note, also where per-area rules live ("From 2 bedrooms up"). Spoken after the fee. */
  note: string | null;
};
export type AreaPicks = { version: 1; tree_version: string; picks: AreaPick[] };
export type TriState = "on" | "off" | "part";

export const AREA_TREE_VERSION: string = TREE.version;
export const AREA_NOTE_MAX = 120;
export const AREA_FEE_MAX = 100_000;
export const ROOT_ID = "ke";

const NODES = TREE.nodes as AreaNode[];
const BY_ID = new Map(NODES.map((n) => [n.id, n]));
const KIDS = new Map<string, AreaNode[]>();
for (const n of NODES) {
  if (!n.parent) continue;
  const list = KIDS.get(n.parent) ?? [];
  list.push(n);
  KIDS.set(n.parent, list);
}

export function areaNode(id: string): AreaNode | null {
  return BY_ID.get(id) ?? null;
}
export function areaChildren(id: string): AreaNode[] {
  return KIDS.get(id) ?? [];
}
export function areaCounties(): AreaNode[] {
  return [...areaChildren(ROOT_ID)].sort((a, b) => a.name.localeCompare(b.name));
}
export function areaAncestors(id: string): AreaNode[] {
  const out: AreaNode[] = [];
  let cur = areaNode(id)?.parent ?? null;
  while (cur) {
    const n = areaNode(cur);
    if (!n) break;
    out.push(n);
    cur = n.parent;
  }
  return out;
}
function descendants(id: string): AreaNode[] {
  const out: AreaNode[] = [];
  const stack = [...areaChildren(id)];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    stack.push(...areaChildren(n.id));
  }
  return out;
}
export function countyOf(id: string): AreaNode | null {
  const n = areaNode(id);
  if (!n) return null;
  if (n.kind === "county") return n;
  return areaAncestors(id).find((a) => a.kind === "county") ?? null;
}
/** "Kajiado County" for towns, "Nairobi" for estates, "Kenya" for counties. */
export function areaWhere(id: string): string {
  const n = areaNode(id);
  if (!n) return "";
  if (n.kind === "county") return "County";
  const c = countyOf(id);
  return c ? c.name : "";
}

export function emptyAreaPicks(): AreaPicks {
  return { version: 1, tree_version: AREA_TREE_VERSION, picks: [] };
}

function cleanFee(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(/[, ]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), AREA_FEE_MAX);
}
function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim().slice(0, AREA_NOTE_MAX);
  return t || null;
}

/** Drops unknown nodes and duplicates (last wins). Safe on any stored JSON. */
export function normalizeAreaPicks(raw: unknown): AreaPicks {
  const src = raw && typeof raw === "object" ? (raw as { picks?: unknown }).picks : null;
  const byNode = new Map<string, AreaPick>();
  if (Array.isArray(src)) {
    for (const p of src) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      const node = typeof o.node === "string" ? o.node : "";
      if (!BY_ID.has(node)) continue;
      const serve = o.serve !== false;
      byNode.set(node, {
        node,
        serve,
        fee_kes: serve ? cleanFee(o.fee_kes) : null,
        note: serve ? cleanNote(o.note) : null,
      });
    }
  }
  return { version: 1, tree_version: AREA_TREE_VERSION, picks: [...byNode.values()] };
}

function pickMap(p: AreaPicks): Map<string, AreaPick> {
  return new Map(p.picks.map((x) => [x.node, x]));
}

export type AreaResolution = {
  covered: boolean;
  /** Node whose pick decided coverage, null when nothing applies. */
  via: string | null;
  fee_kes: number | null;
  note: string | null;
};

/** Nearest pick wins; fee and note inherit from serving ancestors. */
export function resolveArea(picks: AreaPicks, id: string): AreaResolution {
  const m = pickMap(picks);
  const chain = [areaNode(id), ...areaAncestors(id)].filter(Boolean) as AreaNode[];
  let decided: AreaPick | null = null;
  let fee: number | null = null;
  let note: string | null = null;
  for (const n of chain) {
    const p = m.get(n.id);
    if (!p) continue;
    if (!decided) decided = p;
    if (decided && !decided.serve) break;
    if (p.serve === false) break;
    if (fee == null && p.fee_kes != null) fee = p.fee_kes;
    if (note == null && p.note) note = p.note;
  }
  if (!decided || !decided.serve) return { covered: false, via: decided?.node ?? null, fee_kes: null, note: null };
  return { covered: true, via: decided.node, fee_kes: fee, note };
}

export function areaState(picks: AreaPicks, id: string): TriState {
  const self = resolveArea(picks, id).covered;
  const ds = descendants(id);
  if (!ds.length) return self ? "on" : "off";
  let on = 0;
  for (const d of ds) if (resolveArea(picks, d.id).covered) on++;
  if (self && on === ds.length) return "on";
  if (!self && on === 0) return "off";
  return "part";
}

/** Drops picks that say what their parent already resolves to (no fee/note). */
export function simplifyAreaPicks(picks: AreaPicks): AreaPicks {
  let cur = picks;
  for (let pass = 0; pass < 4; pass++) {
    const m = pickMap(cur);
    const keep = cur.picks.filter((p) => {
      if (p.fee_kes != null || p.note) return true;
      const parent = areaNode(p.node)?.parent;
      const inherited = parent ? resolveArea({ ...cur, picks: cur.picks.filter((x) => x.node !== p.node) }, p.node).covered : false;
      void m;
      return inherited !== p.serve;
    });
    if (keep.length === cur.picks.length) break;
    cur = { ...cur, picks: keep };
  }
  return cur;
}

/** Tap a checkbox: full on, or full off, for the node and everything under it. */
export function toggleArea(picks: AreaPicks, id: string): AreaPicks {
  const state = areaState(picks, id);
  const serve = state !== "on";
  const under = new Set(descendants(id).map((d) => d.id));
  const prior = pickMap(picks).get(id);
  const rest = picks.picks.filter((p) => p.node !== id && !under.has(p.node));
  const next: AreaPick = {
    node: id,
    serve,
    fee_kes: serve ? prior?.fee_kes ?? null : null,
    note: serve ? prior?.note ?? null : null,
  };
  return simplifyAreaPicks({ ...picks, picks: [...rest, next] });
}

/** Sheet "Done": set serve, fee and note on one node (children keep their own picks). */
export function setAreaDetail(
  picks: AreaPicks,
  id: string,
  detail: { serve: boolean; fee_kes: unknown; note: unknown },
): AreaPicks {
  const rest = picks.picks.filter((p) => p.node !== id);
  const next: AreaPick = {
    node: id,
    serve: detail.serve,
    fee_kes: detail.serve ? cleanFee(detail.fee_kes) : null,
    note: detail.serve ? cleanNote(detail.note) : null,
  };
  return simplifyAreaPicks({ ...picks, picks: [...rest, next] });
}

export function areaPick(picks: AreaPicks, id: string): AreaPick | null {
  return pickMap(picks).get(id) ?? null;
}

/** Stable comparison for the Save bar change count. */
export function areaPicksDiffCount(a: AreaPicks, b: AreaPicks): number {
  const ma = pickMap(a);
  const mb = pickMap(b);
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  let n = 0;
  for (const k of keys) if (JSON.stringify(ma.get(k) ?? null) !== JSON.stringify(mb.get(k) ?? null)) n++;
  return n;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type SummaryPart = { text: string; strong: boolean };

/** "You cover all of Nairobi except Kibera, plus Kiambu, Kitengela and Syokimau." */
export function areaSummaryParts(picks: AreaPicks): SummaryPart[] {
  const serving = picks.picks.filter((p) => p.serve && !areaAncestors(p.node).some((a) => resolveArea(picks, a.id).covered));
  if (!serving.length) return [{ text: "You don't cover any areas yet. Tick the places you serve.", strong: false }];
  const order = (p: AreaPick) => {
    const k = areaNode(p.node)?.kind;
    return k === "country" ? 0 : k === "county" ? 1 : 2;
  };
  // Nairobi first (as callers and the mockup expect), then the rest by name.
  const nairobi = (p: AreaPick) =>
    p.node === "county:nairobi" || areaAncestors(p.node).some((a) => a.id === "county:nairobi") ? 0 : 1;
  serving.sort((a, b) => order(a) - order(b) || nairobi(a) - nairobi(b) || (areaNode(a.node)?.name ?? "").localeCompare(areaNode(b.node)?.name ?? ""));
  const items = serving.map((p) => {
    const n = areaNode(p.node)!;
    const under = new Set(descendants(n.id).map((d) => d.id));
    const off = picks.picks.filter((x) => !x.serve && under.has(x.node)).map((x) => areaNode(x.node)!.name);
    if (off.length) return `all of ${n.name} except ${joinNames(off)}`;
    return n.name;
  });
  const out: SummaryPart[] = [{ text: "You cover ", strong: false }];
  const first = items[0];
  out.push({ text: first, strong: true });
  const others = items.slice(1);
  if (others.length) {
    out.push({ text: ", plus ", strong: false });
    others.forEach((t, i) => {
      if (i > 0) out.push({ text: i === others.length - 1 ? " and " : ", ", strong: false });
      out.push({ text: t, strong: true });
    });
  }
  out.push({ text: ".", strong: false });
  return out;
}

/** "8 of 9 shown · 1 off", "All areas", "Kitengela only", "Off". */
export function areaRowMeta(picks: AreaPicks, id: string): string {
  const n = areaNode(id);
  if (!n) return "";
  if (n.kind === "country") {
    const cs = areaChildren(id);
    const on = cs.filter((c) => areaState(picks, c.id) !== "off").length;
    return `${on} of ${cs.length} counties`;
  }
  const kids = areaChildren(id);
  const state = areaState(picks, id);
  if (!kids.length) return state === "on" ? "Whole county" : "Off";
  if (state === "on") return "All areas";
  if (state === "off") return "Off";
  const onKids = kids.filter((k) => resolveArea(picks, k.id).covered);
  if (!resolveArea(picks, id).covered && onKids.length <= 2) return `${joinNames(onKids.map((k) => k.name))} only`;
  const off = kids.length - onKids.length;
  return `${onKids.length} of ${kids.length} shown${off ? ` · ${off} off` : ""}`;
}

// ---------- search ----------

export function normAreaText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
function fuzzy(q: string, name: string): number {
  return Math.min(editDistance(q, name.slice(0, q.length)), editDistance(q, name));
}

export type AreaHit = { node: AreaNode; via: "name" | "alias" | "fuzzy" | "landmark"; label: string; where: string };
export type AreaSearch = { areas: AreaHit[]; didYouMean: AreaHit[]; landmarks: AreaHit[] };

export function searchAreaTree(query: string, limit = 8): AreaSearch {
  const q = normAreaText(query);
  const out: AreaSearch = { areas: [], didYouMean: [], landmarks: [] };
  if (!q) return out;
  const seen = new Set<string>();
  const where = (n: AreaNode) => areaWhere(n.id);
  for (const n of NODES) {
    if (n.kind === "country") continue;
    const name = normAreaText(n.name);
    if (name.startsWith(q) || name.split(" ").some((w) => w.startsWith(q))) {
      out.areas.push({ node: n, via: "name", label: n.name, where: where(n) });
      seen.add(n.id);
      continue;
    }
    const al = n.aliases.find((a) => normAreaText(a).startsWith(q));
    if (al) {
      out.areas.push({ node: n, via: "alias", label: n.name, where: `${where(n)} · also “${al}”` });
      seen.add(n.id);
    }
  }
  const tol = q.length >= 5 ? 2 : q.length >= 4 ? 1 : 0;
  if (tol) {
    const nearCounty = out.areas[0] ? countyOf(out.areas[0].node.id)?.id ?? null : null;
    const cands: Array<{ n: AreaNode; d: number; near: number; pre: number }> = [];
    for (const n of NODES) {
      if (n.kind === "country" || seen.has(n.id)) continue;
      const names = [n.name, ...n.aliases].map(normAreaText);
      const d = Math.min(...names.map((x) => fuzzy(q, x)));
      if (d > tol) continue;
      let pre = 0;
      const nm = normAreaText(n.name);
      while (pre < q.length && nm[pre] === q[pre]) pre++;
      cands.push({ n, d, near: nearCounty && countyOf(n.id)?.id === nearCounty ? 0 : 1, pre });
    }
    cands.sort((a, b) => a.d - b.d || a.near - b.near || b.pre - a.pre || a.n.name.localeCompare(b.n.name));
    for (const c of cands) {
      out.didYouMean.push({ node: c.n, via: "fuzzy", label: c.n.name, where: where(c.n) });
      seen.add(c.n.id);
    }
  }
  for (const n of NODES) {
    for (const lm of n.landmarks) {
      const l = normAreaText(lm);
      if (l.includes(q) || (q.length >= 5 && fuzzy(q, l) <= 1)) {
        out.landmarks.push({ node: n, via: "landmark", label: lm, where: `In ${n.name}${n.kind === "county" ? "" : `, ${where(n)}`}` });
        break;
      }
    }
  }
  out.areas = out.areas.slice(0, limit);
  out.didYouMean = out.didYouMean.slice(0, 4);
  out.landmarks = out.landmarks.slice(0, 4);
  return out;
}

/** Best single node for a free-text place (exact name, alias, landmark, then close spelling). */
export function matchAreaText(text: string): AreaNode | null {
  const q = normAreaText(text);
  if (!q) return null;
  const exact = NODES.filter((n) => n.kind !== "country" && (normAreaText(n.name) === q || n.aliases.some((a) => normAreaText(a) === q)));
  if (exact.length) return exact.find((n) => n.kind !== "county") && exact.find((n) => n.kind === "county") ? exact.find((n) => n.kind === "county")! : exact[0];
  for (const n of NODES) if (n.landmarks.some((l) => normAreaText(l) === q)) return n;
  const s = searchAreaTree(text, 1);
  const hit = s.areas[0] ?? s.didYouMean[0];
  return hit && normAreaText(hit.label).length - q.length <= 3 ? hit.node : null;
}

// ---------- what callers hear ----------

export type CallerLine = { status: "covered" | "not_covered" | "not_on_map"; reply: string; node: AreaNode | null };

export function callerHears(picks: AreaPicks, place: string): CallerLine {
  const n = matchAreaText(place);
  if (!n) return { status: "not_on_map", reply: "Which area is that near?", node: null };
  const r = resolveArea(picks, n.id);
  if (!r.covered) return { status: "not_covered", reply: `Sorry, we don't cover ${n.name}.`, node: n };
  let reply = `Yes, we cover ${n.name}.`;
  if (r.fee_kes != null) reply += ` There's an extra KES ${r.fee_kes.toLocaleString("en-KE")}.`;
  if (r.note) reply += ` ${r.note.replace(/[.!?]*$/, "")}.`;
  return { status: "covered", reply, node: n };
}

// ---------- move-over from the old free-text list ----------

export type MoveOverQuestion = { raw: string; county: string; town: string };
export type MoveOverRow = { node: string; raw: string; insideOf: string | null };
export type MoveOver = { picks: AreaPicks; rows: MoveOverRow[]; questions: MoveOverQuestion[]; unmatched: string[] };

function rawName(entry: string): string {
  return entry.replace(/^(county|place):/, "").trim();
}

/**
 * Old Locations ids ("county:kiambu", "place:juja") or plain names to picks.
 * A name that is both a county and a town (Kiambu) is a question; the default is the whole county.
 */
export function moveOverAreas(old: string[], answers: Record<string, "county" | "town"> = {}): MoveOver {
  let picks = emptyAreaPicks();
  const rows: MoveOverRow[] = [];
  const questions: MoveOverQuestion[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const entry of old) {
    const raw = rawName(entry);
    const q = normAreaText(raw);
    if (!q || seen.has(q)) continue;
    seen.add(q);
    const county = NODES.find((n) => n.kind === "county" && normAreaText(n.name) === q) ?? null;
    const town = NODES.find((n) => n.kind !== "county" && n.kind !== "country" && (normAreaText(n.name) === q || n.aliases.some((a) => normAreaText(a) === q))) ?? null;
    let node: AreaNode | null = null;
    if (county && town) {
      questions.push({ raw, county: county.id, town: town.id });
      const forcedCounty = entry.startsWith("county:");
      node = answers[county.id] === "town" ? town : answers[county.id] === "county" || forcedCounty || !answers[county.id] ? county : county;
    } else node = county ?? town ?? matchAreaText(raw);
    if (!node) {
      unmatched.push(raw);
      continue;
    }
    picks = { ...picks, picks: [...picks.picks.filter((p) => p.node !== node!.id), { node: node.id, serve: true, fee_kes: null, note: null }] };
    rows.push({ node: node.id, raw, insideOf: null });
  }
  for (const r of rows) {
    const cover = areaAncestors(r.node).find((a) => picks.picks.some((p) => p.node === a.id && p.serve));
    r.insideOf = cover ? cover.name : null;
  }
  return { picks: simplifyAreaPicks(picks), rows, questions, unmatched };
}

// ---------- confirm state (Brain #942 answers only from confirmed picks) ----------

/**
 * none: no picks and no old list. old_only: old list but no picks row yet.
 * unconfirmed: picks never confirmed. edited: picks changed after the last confirm (not by the owner's own save).
 * confirmed: callers get the map answers.
 */
export type AreaConfirmState = "none" | "old_only" | "unconfirmed" | "edited" | "confirmed";

export function areaConfirmState(
  row: { confirmed_at: string | null; updated_at: string | null; pickCount: number } | null,
  oldListCount: number,
): AreaConfirmState {
  if (!row) return oldListCount > 0 ? "old_only" : "none";
  if (!row.confirmed_at) return row.pickCount > 0 || oldListCount > 0 ? "unconfirmed" : "none";
  const c = Date.parse(row.confirmed_at);
  const u = row.updated_at ? Date.parse(row.updated_at) : NaN;
  // 2s slack: owner saves stamp both columns together.
  if (Number.isFinite(c) && Number.isFinite(u) && u - c > 2000) return "edited";
  return "confirmed";
}

export function areaNeedsConfirm(s: AreaConfirmState): boolean {
  return s === "old_only" || s === "unconfirmed" || s === "edited";
}

/** One calm line, same on Desk home and Service areas. */
export const AREA_CONFIRM_COPY = {
  title: "Confirm your service areas",
  editedTitle: "Your areas changed since you confirmed",
  detail: "Until you confirm, callers who ask about a place hear “the team will confirm”.",
} as const;
