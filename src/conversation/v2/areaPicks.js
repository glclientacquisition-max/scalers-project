'use strict';
// Brain side of the Desk ↔ Brain area contract (docs/reference/platform/AREA_PICKS.md, Desk #930).
// ONE tree: Desk's dashboard/src/lib/data/kenyaAreaTree.v1.json (copied into the Voice image by the Dockerfile).
// Logic is a line-for-line CommonJS port of dashboard/src/lib/areaPicks.ts (normalizeAreaPicks, resolveArea,
// matchAreaText, callerHears) so a caller hears what Desk's "what callers will hear" preview shows.
// tests/brainAreaPicks.test.js runs both on the same inputs (parity). Missing tree file -> available() false.
const path = require('path');

let TREE = null;
try { TREE = require(path.join(__dirname, '../../../dashboard/src/lib/data/kenyaAreaTree.v1.json')); } catch { TREE = null; }
const NODES = TREE && Array.isArray(TREE.nodes) ? TREE.nodes : [];
const BY_ID = new Map(NODES.map((n) => [n.id, n]));
const AREA_FEE_MAX = 100000; const AREA_NOTE_MAX = 200;

const available = () => NODES.length > 0;
const areaNode = (id) => BY_ID.get(id) || null;
function areaAncestors(id) { const out = []; let cur = (areaNode(id) || {}).parent || null; while (cur) { const n = areaNode(cur); if (!n) break; out.push(n); cur = n.parent; } return out; }
function countyOf(id) { const n = areaNode(id); if (!n) return null; if (n.kind === 'county') return n; return areaAncestors(id).find((a) => a.kind === 'county') || null; }

function cleanFee(raw) { const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.replace(/[, ]/g, '')) : NaN; if (!Number.isFinite(n) || n <= 0) return null; return Math.min(Math.round(n), AREA_FEE_MAX); }
function cleanNote(raw) { if (typeof raw !== 'string') return null; const t = raw.replace(/\s+/g, ' ').trim().slice(0, AREA_NOTE_MAX); return t || null; }

/** One row per node from public.tenant_area_picks (Brain #960). */
function normalizeAreaPicksFromRows(rows) {
  const byNode = new Map(); let treeVersion = null;
  for (const o of rows) {
    if (!o || typeof o !== 'object') continue;
    const node = typeof o.node === 'string' ? o.node : '';
    if (!BY_ID.has(node)) continue;
    treeVersion = o.tree_version || treeVersion;
    const serve = o.serve !== false;
    byNode.set(node, {
      node, serve,
      fee_kes: serve ? cleanFee(o.fee_kes) : null,
      note: serve ? cleanNote(o.note) : null,
      confirmed_at: o.confirmed_at || null,
    });
  }
  return { version: 1, tree_version: treeVersion || (TREE ? TREE.version : null), picks: [...byNode.values()] };
}

/** Legacy jsonb blob or in-memory tests: unknown nodes dropped (last wins). tenantConfirmedAt backfills per-row confirmed_at. */
function normalizeAreaPicks(raw, opts = {}) {
  const tenantAt = opts.tenantConfirmedAt || opts.confirmed_at || (raw && raw.confirmed_at) || null;
  const src = raw && typeof raw === 'object' ? raw.picks : null; const byNode = new Map();
  if (Array.isArray(src)) for (const o of src) {
    if (!o || typeof o !== 'object') continue; const node = typeof o.node === 'string' ? o.node : '';
    if (!BY_ID.has(node)) continue; const serve = o.serve !== false;
    byNode.set(node, {
      node, serve,
      fee_kes: serve ? cleanFee(o.fee_kes) : null,
      note: serve ? cleanNote(o.note) : null,
      confirmed_at: o.confirmed_at || tenantAt || null,
    });
  }
  return { version: 1, tree_version: (raw && raw.tree_version) || (TREE ? TREE.version : null), picks: [...byNode.values()] };
}

/** Nearest confirmed pick on the chain wins; fee/note inherit from confirmed serving ancestors. */
function resolveArea(picks, id) {
  const m = new Map(picks.picks.map((x) => [x.node, x]));
  const chain = [areaNode(id), ...areaAncestors(id)].filter(Boolean);
  let decided = null; let fee = null; let note = null;
  for (const n of chain) {
    const p = m.get(n.id); if (!p) continue;
    if (!decided) decided = p;
    if (!p.confirmed_at) return { covered: false, via: decided.node, unconfirmed: true, fee_kes: null, note: null };
    if (decided && !decided.serve) break;
    if (p.serve === false) break;
    if (fee == null && p.fee_kes != null) fee = p.fee_kes;
    if (note == null && p.note) note = p.note;
  }
  if (!decided) return { covered: false, via: null, unconfirmed: false, fee_kes: null, note: null };
  if (!decided.confirmed_at) return { covered: false, via: decided.node, unconfirmed: true, fee_kes: null, note: null };
  if (!decided.serve) return { covered: false, via: decided.node, unconfirmed: false, fee_kes: null, note: null };
  return { covered: true, via: decided.node, fee_kes: fee, note, unconfirmed: false };
}

function normAreaText(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const fuzzy = (q, name) => Math.min(editDistance(q, name.slice(0, q.length)), editDistance(q, name));

/** Desk searchAreaTree (the parts matchAreaText uses). */
function searchAreaTree(query, limit = 8) {
  const q = normAreaText(query); const out = { areas: [], didYouMean: [] }; if (!q) return out;
  const seen = new Set();
  for (const n of NODES) {
    if (n.kind === 'country') continue; const name = normAreaText(n.name);
    if (name.startsWith(q) || name.split(' ').some((w) => w.startsWith(q))) { out.areas.push({ node: n, via: 'name', label: n.name }); seen.add(n.id); continue; }
    if (n.aliases.find((a) => normAreaText(a).startsWith(q))) { out.areas.push({ node: n, via: 'alias', label: n.name }); seen.add(n.id); }
  }
  const tol = q.length >= 5 ? 2 : q.length >= 4 ? 1 : 0;
  if (tol) {
    const nearCounty = out.areas[0] ? (countyOf(out.areas[0].node.id) || {}).id || null : null; const cands = [];
    for (const n of NODES) {
      if (n.kind === 'country' || seen.has(n.id)) continue;
      const d = Math.min(...[n.name, ...n.aliases].map(normAreaText).map((x) => fuzzy(q, x))); if (d > tol) continue;
      let pre = 0; const nm = normAreaText(n.name); while (pre < q.length && nm[pre] === q[pre]) pre++;
      cands.push({ n, d, near: nearCounty && (countyOf(n.id) || {}).id === nearCounty ? 0 : 1, pre });
    }
    cands.sort((a, b) => a.d - b.d || a.near - b.near || b.pre - a.pre || a.n.name.localeCompare(b.n.name));
    for (const c of cands) out.didYouMean.push({ node: c.n, via: 'fuzzy', label: c.n.name });
  }
  out.areas = out.areas.slice(0, limit); out.didYouMean = out.didYouMean.slice(0, 4);
  return out;
}

/** Desk matchAreaText: exact name or alias, then landmark, then close spelling. */
function matchAreaText(text) {
  const q = normAreaText(text); if (!q) return null;
  const exact = NODES.filter((n) => n.kind !== 'country' && (normAreaText(n.name) === q || n.aliases.some((a) => normAreaText(a) === q)));
  if (exact.length) return exact.find((n) => n.kind !== 'county') && exact.find((n) => n.kind === 'county') ? exact.find((n) => n.kind === 'county') : exact[0];
  for (const n of NODES) if (n.landmarks.some((l) => normAreaText(l) === q)) return n;
  const s = searchAreaTree(text, 1); const hit = s.areas[0] || s.didYouMean[0];
  return hit && normAreaText(hit.label).length - q.length <= 3 ? hit.node : null;
}

const kes = (n) => Number(n).toLocaleString('en-KE');
/** The owner's note language. Notes are free text (Desk #944: never parsed for rules) with no Swahili variant
 *  (unlike policy_lines.<topic>.{en,sw}), so a Swahili turn speaks it verbatim and is flagged when it is not Swahili. */
function noteLang(note) {
  if (!note) return null; const d = require('./lexicon').detectLang(note);
  return d.sw > d.en ? 'sw' : 'en';
}
/** Desk callerHears, plus the Kiswahili line Brain speaks. [PROMPT-PLACEHOLDER] for the sw wording. */
function callerHears(picks, place, lang = 'en') {
  const sw = /^sw/.test(String(lang || ''));
  const n = matchAreaText(place);
  if (!n) return { status: 'not_on_map', reply: sw ? 'Hiyo iko karibu na eneo gani?' : 'Which area is that near?', node: null };
  return linesFor(picks, n, lang);
}
function linesFor(picks, n, lang = 'en') {
  const sw = /^sw/.test(String(lang || ''));
  const r = resolveArea(picks, n.id);
  if (r.unconfirmed) return { status: 'unconfirmed', reply: sw ? `Nitaangalia na mmiliki kuhusu ${n.name}.` : `I'll check with the owner about ${n.name}.`, node: n, res: r };
  if (!r.covered) return { status: 'not_covered', reply: sw ? `Samahani, hatufiki ${n.name}.` : `Sorry, we don't cover ${n.name}.`, node: n, res: r };
  let reply = sw ? `Ndio, tunafika ${n.name}.` : `Yes, we cover ${n.name}.`;
  if (r.fee_kes != null) reply += sw ? ` Kuna ada ya ziada ya KES ${kes(r.fee_kes)}.` : ` There's an extra KES ${kes(r.fee_kes)}.`;
  // the owner's note, verbatim after the fee (Desk preview order); never translated, never parsed
  if (r.note) reply += ` ${r.note.replace(/[.!?]*$/, '')}.`;
  const nl = noteLang(r.note);
  return { status: 'covered', reply, node: n, res: r, note: r.note, note_lang: nl, note_untranslated: Boolean(sw && r.note && nl !== 'sw') };
}

module.exports = {
  available, treeVersion: () => (TREE ? TREE.version : null), NODES, areaNode, areaAncestors, countyOf,
  normalizeAreaPicks, normalizeAreaPicksFromRows, resolveArea, normAreaText, editDistance, matchAreaText, callerHears, linesFor, noteLang,
};
