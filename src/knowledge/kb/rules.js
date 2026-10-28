'use strict';
// The 12 call rules (Hick's law research, Page "v2 Knowledge Base", 28 Oct) as code. Each answer is a receipt:
// short spoken sentences built from the snapshot, which the model may phrase but never extend.
//  1 open, never list unprompted       2 <= 3 names per turn       3 count first       4 > 3: one narrowing question
//  5 order: caller's words, popular, owner order       6 no prices in a list; price for the one item, range for a group
//  7 one question, at the end           8 one fit: no choice offered   9 pick by name, Swahili name or position
// 10 more only on request, in threes   11 sound-alike names keep their telling word (compile)   12 <= 2 short sentences
const { numberToSw } = require('../../speech/spokenForms');
const { joinList, sayRange } = require('./spoken');
const { tokens } = require('./keys');
const { GENERIC } = require('./reader');

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
  // a quote or a site visit is a real answer: say how it is priced, then offer to take details (capture)
  if (it.price.visit) return { text: sw ? `Bei ya ${short(it, lang)} hutolewa baada ya kukagua eneo. Nichukue maelezo yako ili timu ipange?` : `${cap(short(it, lang))} is priced after a site visit. Shall I take your details so the team can arrange it?`, numbers: [], capture: 'site_visit' };
  if (it.price.quote) return { text: sw ? `${cap(short(it, lang))} ni bei maalum; timu itakupa bei baada ya kukagua kazi. Nichukue maelezo yako?` : `${cap(short(it, lang))} is a custom quote; the team will give you a price after checking the job. Shall I take your details for that?`, numbers: [], capture: 'quote' };
  return { text: sw ? `${cap(short(it, lang))} ni ${say}.` : `${cap(short(it, lang))} is ${say}.`, numbers: it.price.numbers || [] };
}
function oneItem(it, { asksPrice, lang }) {
  const sw = isSw(lang);
  if (it.in_stock === false) return { kind: 'item', ids: [it.id], text: sw ? `Samahani, ${short(it, lang)} imeisha kwa sasa.` : `Sorry, ${short(it, lang)} is out of stock right now.`, numbers: [] };
  if (asksPrice) { const p = priceSentence(it, lang); return { kind: 'item', ids: [it.id], text: p.text, numbers: p.numbers, unknown: !!p.unknown, capture: p.capture || null, name: it.name }; }
  // rule 8: one fit, no choice offered
  return { kind: 'item', ids: [it.id], text: sw ? `Ndiyo, tuna ${short(it, lang)}.` : `Yes, we have ${short(it, lang)}.`, numbers: [] };
}
/** One item and its own price, for a short list (root cause 5). */
function pricePair(m, lang) {
  const sw = isSw(lang); const nm = short(m, lang);
  if (m.in_stock === false) return sw ? `${nm} imeisha kwa sasa` : `${nm} is out of stock`;
  if (m.variants && m.variants.length) return sw ? `bei ya ${nm} inategemea aina` : `${nm} depends on the option`;
  if (m.price.visit) return sw ? `${nm} hupangiwa bei baada ya kukagua eneo` : `${nm} is priced after a site visit`;
  if (m.price.quote) return sw ? `${nm} ni bei maalum` : `${nm} is a custom quote`;
  const say = sw ? m.price.say_sw : m.price.say_en;
  if (say) return sw ? `${nm} ni ${say}` : `${nm} is ${say}`;
  return sw ? `timu itathibitisha bei ya ${nm}` : `the team will confirm the price of ${nm}`;
}
// Swahili words that mark an owner note as written in Swahili (area-pick note rule: say it only in its own language)
const SW_NOTE = /\b(tutarudi|itarudi|inarudi|wiki|ijayo|mwezi|kesho|baada|kwa sasa|hadi|mpaka|tumesimamisha|imesimamishwa|karibuni|siku)\b/i;
const noteLang = (note) => (SW_NOTE.test(String(note || '')) ? 'sw' : 'en');
/**
 * A paused / not-offered item the caller named (root cause 2): a grounded answer, never "not sure".
 * Paused: the owner's note in its own language (an English note in a Swahili call becomes "the team will confirm when
 * it's back"), then one offer to have the team call back when it is back (capture 'when_back': a yes starts the normal
 * callback capture with read-back + yes + commit gate). tail=false drops the closing question (combined answers).
 */
function offItem(it, lang, { tail = true } = {}) {
  const sw = isSw(lang);
  const name = (sw && it.say_sw) || it.say_en;
  if (it.state === 'paused') {
    const note = it.note ? it.note.replace(/[.!?]+$/, '') : null;
    const noteSw = note && noteLang(note) === 'sw' ? note : null;
    const en = `Sorry, ${name} isn't available right now${note && noteLang(note) === 'en' ? ` (${note})` : ''}.`;
    const swt = `Samahani, ${name} haipatikani kwa sasa; ${noteSw ? `${noteSw.charAt(0).toLowerCase()}${noteSw.slice(1)}` : 'timu itathibitisha lini itarudi'}.`;
    const q = sw ? 'Ungependa timu ikupigie ikirudi?' : "Shall I have the team call you when it's back?";
    return { kind: 'item', ids: [it.id], itemState: 'paused', numbers: [], name: it.name, ...(tail ? { capture: 'when_back' } : {}),
      text: tail ? `${sw ? swt : en} ${q}` : (sw ? swt : en) };
  }
  const product = it.kind === 'product';
  const t = sw ? `Samahani, ${product ? 'hatuuzi' : 'hatufanyi'} ${name}.` : `Sorry, we don't ${product ? 'sell' : 'offer'} ${name}.`;
  return { kind: 'item', ids: [it.id], itemState: 'not_offered', numbers: [],
    text: tail ? `${t} ${sw ? 'Naweza kukusaidia na kitu kingine?' : 'Can I help with anything else?'}` : t };
}
// not_included (services): only when the caller asks whether X includes Y; can_be_held (products): "keep one for me?"
const INCLUDE_RE = /\b(include|includes|including|included|come with|comes with|part of|cover|covers|also (?:do|clean|wash)|inahusisha|inajumuisha|pamoja na|mnafanya pia|pia mnafanya|inahusu)\b/i;
const HOLD_RE = /\b(hold|keep|reserve|set aside|put aside|save)\b(?!\s+on\b)(?!\s+going\b).{0,30}\b(for me|one|it|them|some)\b|\b(niwekee|uniwekee|nihifadhie|unihifadhie|kuniwekea|kunihifadhia|mniwekee)\b/i;
function excludedPart(it, text) {
  if (!it || !it.excludes) return null;
  const said = tokens(text).filter((w) => !GENERIC.has(w));
  const own = new Set(tokens(it.name));
  const ask = said.filter((w) => !own.has(w));
  if (!ask.length) return null;
  for (const part of String(it.excludes).split(/[,;\n]|\band\b|\bor\b/i).map((x) => x.trim()).filter(Boolean)) {
    const ks = tokens(part).filter((w) => !GENERIC.has(w));
    if (ks.length && ks.some((k) => ask.includes(k))) return part.replace(/[.!?]+$/, '');
  }
  return null;
}
function excludesAnswer(it, part, lang) {
  const sw = isSw(lang); const nm = short(it, lang);
  return { kind: 'item', ids: [it.id], numbers: [], itemState: 'not_included', text: sw ? `${cap(nm)} haihusishi ${part.toLowerCase()}.` : `${cap(nm)} doesn't include ${part.toLowerCase()}.` };
}
function holdAnswer(it, lang) {
  const sw = isSw(lang); const nm = short(it, lang);
  if (it.holdable) return { kind: 'item', ids: [it.id], numbers: [], hold: true, capture: 'hold', name: it.name, text: sw ? `Tunaweza kukuwekea ${nm}. Nichukue jina na nambari yako?` : `We can hold ${nm} for you. Shall I take your name and number?` };
  return { kind: 'item', ids: [it.id], numbers: [], hold: false, text: sw ? `Hatuwezi kukuwekea ${nm}, lakini unaweza kuja au kuagiza.` : `We can't hold ${nm}, but you can come in or order.` };
}
function group(members, { cat = null, asksPrice, lang, offset = 0, narrowed = 0 }) {
  const sw = isSw(lang);
  const shown = members.slice(offset, offset + MAX_NAMES);
  const names = joinList(shown.map((m) => short(m, lang)), lang);
  const nums = [];
  // rule 6: a group gets one range, said inside the count sentence (rule 12: the reply stays two sentences)
  let span = null;
  // root cause 5 (price binding): a price is always said right after its own item. Up to 3 names with prices are
  // item + price pairs; a bigger group may carry one true range (low to high) on its count, never a single
  // number after a list of names ("Deep clean and Post-construction clean, 6,000 shillings").
  if (asksPrice && offset === 0 && members.length <= MAX_NAMES) {
    for (const m of shown) nums.push(...((!m.price.review && m.price.numbers) || []));
    const pairs = shown.map((m) => pricePair(m, lang));
    const s1p = `${cap(joinList(pairs, lang))}.`;
    const q1 = members.length > 1 ? (sw ? 'Ungependa ipi?' : 'Which one would you like?') : null;
    return { kind: 'group', ids: members.map((m) => m.id), shown: shown.map((m) => m.id), offset, total: members.length, text: q1 ? `${s1p} ${q1}` : s1p, question: q1, numbers: [...nums, members.length], bound: true };
  }
  if (asksPrice && offset === 0) {
    const priced = members.filter((m) => !m.price.review && (m.price.numbers || []).length);
    const all = priced.flatMap((m) => m.price.numbers).filter((v) => v > 0);
    const units = [...new Set(priced.map((m) => m.unit || ''))];
    if (all.length && Math.min(...all) < Math.max(...all)) {
      const sp = cat && cat.span && cat.span.en && priced.length === members.length && (cat.span.numbers || []).length > 1 ? cat.span : sayRange(Math.min(...all), Math.max(...all), units.length === 1 ? units[0] || null : null);
      span = sw ? sp.sw : sp.en; if (span) nums.push(...(sp.numbers || []));
    }
  }
  let s1;
  if (offset > 0) s1 = sw ? `Pia tuna ${names}.` : `We also have ${names}.`;
  else if (members.length <= MAX_NAMES) s1 = sw ? `Tuna ${names}.` : `We have ${names}.`;
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
  // an item the owner paused or marked "we don't do this", named in full: say so plainly instead of "not sure"
  const off = kb.findOff ? kb.findOff(text) : null;
  const namedLen = f.named ? tokens(f.named.name).filter((w) => !GENERIC.has(w)).length : 0;
  // the item this turn is about: named now, else the one item just answered
  const subject = f.named || (last && last.ids && last.ids.length === 1 ? kb.item(last.ids[0]) : null);
  if (subject && (!off || off.len <= namedLen)) {
    if (subject.kind !== 'product' && INCLUDE_RE.test(text)) {
      const part = excludedPart(subject, text);
      if (part) { st.last = { ids: [subject.id], shown: [subject.id], offset: 0 }; st.narrowed = 0; return done({ ...excludesAnswer(subject, part, lang), lookupMs: f.ms }, st); }
    }
    if (subject.kind === 'product' && HOLD_RE.test(text)) { st.last = { ids: [subject.id], shown: [subject.id], offset: 0 }; st.narrowed = 0; return done({ ...holdAnswer(subject, lang), lookupMs: f.ms }, st); }
  }
  if (off && (!f.named || off.len > namedLen)) {
    st.last = null; st.narrowed = 0;
    return done({ ...offItem(off.item, lang), lookupMs: f.ms }, st);
  }
  // an off item and a different active item in one turn: one sentence each (rule 12), the active one first
  if (off && f.named && off.item.id !== f.named.id && !tokens(off.item.name).every((w) => tokens(f.named.name).includes(w))) {
    const a = oneItem(f.named, { asksPrice, lang }); const o = offItem(off.item, lang, { tail: false });
    st.last = { ids: [f.named.id], shown: [f.named.id], offset: 0 }; st.narrowed = 0;
    const first = String(a.text).split(/(?<=[.!?])\s+/)[0];
    return done({ ...a, ids: [f.named.id, off.item.id], itemState: `active+${off.item.state}`, text: `${first} ${o.text}`, capture: null, lookupMs: f.ms }, st);
  }
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
  const names = joinList([...new Set(cats.map((c) => (sw && c.say_sw) || c.say_en).filter(Boolean))].slice(0, MAX_NAMES), lang);
  const product = kb.doc.items.every((x) => x.kind === 'product');
  if (sw) return product ? `Tuna aina ${swCount(n)} za bidhaa, kama ${names}. Unatafuta nini?` : `Tuna huduma ${swCount(n)}, kama ${names}. Unahitaji ipi?`;
  return product ? `We have ${n} products, in groups like ${names}. What are you looking for?` : `We offer ${n} services, like ${names}. Which one do you need?`;
}

module.exports = { answer, overview, offItem, pricePair, noteLang, MAX_NAMES, MORE_RE, INCLUDE_RE, HOLD_RE };
