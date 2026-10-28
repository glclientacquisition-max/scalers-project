'use strict';
// The 12 call rules (Hick's law research, Page "v2 Knowledge Base", 28 Oct) as code. Each answer is a receipt:
// short spoken sentences built from the snapshot, which the model may phrase but never extend.
//  1 open, never list unprompted       2 <= 3 names per turn       3 count first       4 > 3: one narrowing question
//  5 order: caller's words, popular, owner order       6 no prices in a list; price for the one item, range for a group
//  7 one question, at the end           8 one fit: no choice offered   9 pick by name, Swahili name or position
// 10 more only on request, in threes   11 sound-alike names keep their telling word (compile)   12 <= 2 short sentences
const { numberToSw } = require('../../speech/spokenForms');
const { joinList, sayRange } = require('./spoken');

const MAX_NAMES = 3;
const MORE_RE = /\b(more|others?|other ones|what else|any other|else|zingine|nyingine|zaidi|ingine)\b/i;
const POS = [
  [/\b(first|1st|ya kwanza|wa kwanza|la kwanza)\b/i, 0], [/\b(second|2nd|ya pili|wa pili|la pili)\b/i, 1], [/\b(third|3rd|ya tatu|wa tatu|la tatu)\b/i, 2], [/\b(last one|ya mwisho|wa mwisho)\b/i, -1],
];
const isSw = (lang) => /^sw/i.test(String(lang || ''));
const short = (it, lang) => (isSw(lang) && it.say_sw) || it.say_en;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const swCount = (n) => numberToSw(n);

function order(items, scoreOf = () => 0) {
  return [...items].sort((a, b) => (scoreOf(b) - scoreOf(a)) || (Number(b.popular) - Number(a.popular)));
}
function groupLabel(cat, members, lang) {
  const sw = isSw(lang);
  const nm = (sw && cat && cat.say_sw) || (cat && cat.say_en) || null;
  const product = members.every((m) => m.kind === 'product');
  const n = members.length;
  if (sw) return product ? `aina ${swCount(n)} za ${nm || 'bidhaa'}` : `huduma ${swCount(n)} za ${nm || 'aina hii'}`;
  return product ? `${n} kinds of ${nm || 'this'}` : `${n} ${nm ? `${nm} ` : ''}services`;
}
/** A narrowing question on the facet that splits the group best (rule 4), else "which one / more?" (rules 7, 10). */
function narrowQ(members, lang, narrowed = 0) {
  const sw = isSw(lang);
  if (narrowed < 2) {
    const facets = {};
    for (const m of members) for (const [k, v] of Object.entries(m.facets || {})) if (typeof v === 'string' && v) (facets[k] = facets[k] || new Set()).add(v);
    const best = Object.entries(facets).filter(([, vs]) => vs.size >= 2 && vs.size <= 4).sort((a, b) => b[1].size - a[1].size)[0];
    if (best) { const vs = [...best[1]].slice(0, 3); return { text: sw ? `Ungependa ${joinList(vs, 'sw')}?` : `Would you like ${joinList(vs, 'en').replace(/ and ([^,]+)$/, ' or $1')}?`, facet: best[0] }; }
  }
  return { text: sw ? 'Ungependa ipi, au nikutajie zaidi?' : 'Which one would you like, or shall I name more?', facet: null };
}
function priceSentence(it, lang) {
  const sw = isSw(lang);
  if (it.variants && it.variants.length) {
    const vs = it.variants.slice(0, MAX_NAMES).map((v) => (sw && v.say_sw) || v.say_en);
    return { text: sw ? `Bei ya ${short(it, lang)} inategemea: ${joinList(vs, 'sw')}. Ni ipi?` : `${cap(short(it, lang))} depends on the option: ${joinList(vs, 'en').replace(/ and ([^,]+)$/, ' or $1')}. Which one?`, ask: 'variant', numbers: [] };
  }
  const say = sw ? it.price.say_sw : it.price.say_en;
  if (!say) return { text: sw ? `Sina bei kamili ya ${short(it, lang)} hapa; timu inaweza kuthibitisha.` : `I don't have the exact price for ${short(it, lang)} here; the team can confirm.`, ask: null, numbers: [], unknown: true };
  if (it.price.quote) return { text: sw ? `${cap(short(it, lang))} ni ${say}.` : `${cap(short(it, lang))} is priced as ${say}.`, numbers: [] };
  return { text: sw ? `${cap(short(it, lang))} ni ${say}.` : `${cap(short(it, lang))} is ${say}.`, numbers: it.price.numbers || [] };
}
function oneItem(it, { asksPrice, lang }) {
  const sw = isSw(lang);
  if (it.in_stock === false) return { kind: 'item', ids: [it.id], text: sw ? `Samahani, ${short(it, lang)} imeisha kwa sasa.` : `Sorry, ${short(it, lang)} is out of stock right now.`, numbers: [] };
  if (asksPrice) { const p = priceSentence(it, lang); return { kind: 'item', ids: [it.id], text: p.text, numbers: p.numbers, unknown: !!p.unknown }; }
  // rule 8: one fit, no choice offered
  return { kind: 'item', ids: [it.id], text: sw ? `Ndiyo, tuna ${short(it, lang)}.` : `Yes, we have ${short(it, lang)}.`, numbers: [] };
}
function group(members, { cat = null, asksPrice, lang, offset = 0, narrowed = 0 }) {
  const sw = isSw(lang);
  const shown = members.slice(offset, offset + MAX_NAMES);
  const names = joinList(shown.map((m) => short(m, lang)), lang);
  const nums = [];
  // rule 6: a group gets one range, said inside the count sentence (rule 12: the reply stays two sentences)
  let span = null;
  if (asksPrice) {
    const priced = members.filter((m) => !m.price.review && (m.price.numbers || []).length);
    const all = priced.flatMap((m) => m.price.numbers).filter((v) => v > 0);
    const units = [...new Set(priced.map((m) => m.unit || ''))];
    if (all.length) {
      const sp = cat && cat.span && cat.span.en && priced.length === members.length ? cat.span : sayRange(Math.min(...all), Math.max(...all), units.length === 1 ? units[0] || null : null);
      span = sw ? sp.sw : sp.en; if (span) nums.push(...(sp.numbers || []));
    }
  }
  let s1;
  if (offset > 0) s1 = sw ? `Pia tuna ${names}.` : `We also have ${names}.`;
  else if (members.length <= MAX_NAMES) s1 = span ? (sw ? `Tuna ${names}, bei ${span}.` : `We have ${names}, ${span}.`) : (sw ? `Tuna ${names}.` : `We have ${names}.`);
  else s1 = span ? (sw ? `Tuna ${groupLabel(cat, members, lang)}, bei ${span}, kama ${names}.` : `We have ${groupLabel(cat, members, lang)}, ${span}, like ${names}.`) : (sw ? `Tuna ${groupLabel(cat, members, lang)}, kama ${names}.` : `We have ${groupLabel(cat, members, lang)}, like ${names}.`);
  const s2 = '';
  const more = members.length > offset + MAX_NAMES;
  const q = more || members.length > 1 ? narrowQ(members, lang, narrowed) : null;
  const text = [s1, s2].filter(Boolean).join(' ');
  return { kind: 'group', ids: members.map((m) => m.id), shown: shown.map((m) => m.id), offset, total: members.length, text: q ? `${text} ${more ? q.text : (sw ? 'Ungependa ipi?' : 'Which one would you like?')}` : text, question: q ? q.text : null, numbers: [...nums, members.length] };
}

/**
 * The one catalogue answer for this turn.
 * @param {object} kb   reader handle (openKb)
 * @param {string} text the caller's words
 * @param {{ asksPrice?: boolean, lang?: string, state?: object }} o  state: per-call { last: {ids, shown, offset, cat}, narrowed }
 * @returns {{ kind: 'item'|'group'|'none', text, ids, numbers, ms, state }}
 */
function answer(kb, text, { asksPrice = false, lang = 'en', state = {} } = {}) {
  const t0 = process.hrtime.bigint();
  const done = (r, st) => ({ ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6, state: st });
  const st = { ...(state || {}) };
  if (!kb) return done({ kind: 'none', text: null, ids: [], numbers: [] }, st);
  const last = st.last || null;
  // rule 9: a pick by position from the names just said
  if (last && last.shown && last.shown.length) {
    for (const [re, i] of POS) if (re.test(text)) { const id = i < 0 ? last.shown[last.shown.length - 1] : last.shown[i]; const it = id && kb.item(id); if (it) { st.last = { ids: [it.id], shown: [it.id], offset: 0 }; st.narrowed = 0; return done(oneItem(it, { asksPrice, lang }), st); } }
    // rule 10: more only on request, in threes
    if (MORE_RE.test(text) && last.ids.length > (last.offset || 0) + MAX_NAMES) {
      const members = last.ids.map((id) => kb.item(id)).filter(Boolean);
      const cat = last.cat ? kb.categories.find((c) => c.id === last.cat) : null;
      const r = group(members, { cat, asksPrice, lang, offset: (last.offset || 0) + MAX_NAMES, narrowed: st.narrowed || 0 });
      st.last = { ids: r.ids, shown: r.shown, offset: r.offset, cat: last.cat || null };
      return done(r, st);
    }
  }
  const f = kb.find(text);
  if (f.named) { st.last = { ids: [f.named.id], shown: [f.named.id], offset: 0 }; st.narrowed = 0; return done({ ...oneItem(f.named, { asksPrice, lang }), lookupMs: f.ms }, st); }
  if (f.category) {
    const members = order(f.category.item_ids.map((id) => kb.item(id)).filter(Boolean));
    if (members.length === 1) { st.last = { ids: [members[0].id], shown: [members[0].id], offset: 0 }; return done(oneItem(members[0], { asksPrice, lang }), st); }
    const r = group(members, { cat: f.category, asksPrice, lang, narrowed: st.narrowed || 0 });
    st.last = { ids: r.ids, shown: r.shown, offset: 0, cat: f.category.id }; st.narrowed = (st.narrowed || 0) + 1;
    return done({ ...r, lookupMs: f.ms }, st);
  }
  if (f.items.length) {
    const [a, b] = f.items;
    if (!b || a.score >= b.score * 1.5) { st.last = { ids: [a.item.id], shown: [a.item.id], offset: 0 }; return done({ ...oneItem(a.item, { asksPrice, lang }), lookupMs: f.ms }, st); }
    const members = f.items.filter((x) => x.score >= a.score * 0.5).map((x) => x.item);
    const r = group(members, { asksPrice: false, lang, narrowed: st.narrowed || 0 }); // rule 6: several different items, no prices
    st.last = { ids: r.ids, shown: r.shown, offset: 0 }; st.narrowed = (st.narrowed || 0) + 1;
    return done({ ...r, lookupMs: f.ms }, st);
  }
  return done({ kind: 'none', text: null, ids: [], numbers: [] }, st);
}

/** Rule 1: the overview when the caller asks "what do you sell?" with no item or group named: categories, count first. */
function overview(kb, lang = 'en') {
  if (!kb) return null;
  const sw = isSw(lang);
  const cats = kb.categories.filter((c) => c.name).sort((a, b) => b.count - a.count);
  const n = kb.doc.items.length;
  if (!n) return null;
  if (cats.length <= 1) return group(order(kb.doc.items), { lang }).text;
  const names = joinList(cats.slice(0, MAX_NAMES).map((c) => (sw && c.say_sw) || c.say_en), lang);
  const product = kb.doc.items.every((x) => x.kind === 'product');
  if (sw) return product ? `Tuna aina ${swCount(n)} za bidhaa, kama ${names}. Unatafuta nini?` : `Tuna huduma ${swCount(n)}, kama ${names}. Unahitaji ipi?`;
  return product ? `We have ${n} products, in groups like ${names}. What are you looking for?` : `We offer ${n} services, like ${names}. Which one do you need?`;
}

module.exports = { answer, overview, MAX_NAMES, MORE_RE };
