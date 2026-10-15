'use strict';
// v2 catalogue / discovery step (migration step 3, proven-voice-pipeline.md).
// CALM pattern: the model emits one checked command; this state step decides
// the next move; every fact and every service word comes from the tenant's
// spoken catalogue (src/knowledge/spokenCatalogue.js) through templates, in the
// call's locked language. Pipecat-style {{slot}} templates: a missing slot is an
// error, and the step then yields (returns null) so the legacy path answers.
const { validate } = require('./catalogue');
const { resolveSpokenCatalogue } = require('../../knowledge/spokenCatalogue');

const ON = /^(1|true|on|yes)$/i;
const catalogueStepEnabled = (env = process.env) => ON.test(String(env.VOICE_V2_CATALOGUE || ''));
const INTENTS = ['list_services', 'list_category', 'explain_service', 'price_service', 'book_service', 'other'];

function commandSchema(sc) {
  const ids = sc.entries.map((e) => e.id); const cats = sc.categories.map((c) => c.id);
  return { type: 'object', additionalProperties: false, required: ['intent', 'language'], properties: {
    intent: { type: 'string', enum: INTENTS },
    service_id: { type: 'string', enum: ids.length ? ids : ['__none__'] },
    category_id: { type: 'string', enum: cats.length ? cats : ['__none__'] },
    language: { type: 'string', enum: ['sw', 'en'] },
  } };
}
function validateCommand(cmd, sc) {
  if (!cmd || typeof cmd !== 'object') return { ok: false, errors: ['$: expected object'] };
  const clean = Object.fromEntries(Object.entries(cmd).filter(([, v]) => v != null && v !== ''));
  const errors = validate(commandSchema(sc), clean);
  if (!errors.length && ['explain_service', 'price_service', 'book_service'].includes(clean.intent) && !clean.service_id) errors.push('$.service_id: required for intent');
  if (!errors.length && clean.intent === 'list_category' && !clean.category_id) errors.push('$.category_id: required for intent');
  return errors.length ? { ok: false, errors } : { ok: true, command: clean };
}

// ---------- command source 1: Gemini, JSON mode, checked ----------
function buildCommandRequest({ text, sc, lang, history = [] }) {
  const menu = sc.categories.map((c) => ({ category_id: c.id, label: c.en, services: c.entryIds.map((id) => ({ service_id: id, name: sc.entries.find((e) => e.id === id)?.spoken.en })) }));
  const schema = commandSchema(sc);
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'additionalProperties' ? undefined : v)));
  return {
    systemInstruction: { parts: [{ text: `Classify the caller's latest turn about this business's services. Output only the JSON command. Never write a reply. Call language: ${lang}.\nMenu: ${JSON.stringify(menu)}` }] },
    contents: [...history, { role: 'user', parts: [{ text: String(text || '') }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 96, responseMimeType: 'application/json', responseSchema: strip(schema) },
  };
}
function parseCommandResponse(resp) {
  const t = (resp?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(t); } catch { return null; }
}

// ---------- command source 2: deterministic, from v2 NLU (fallback + tests) ----------
const SERVICES_ASK = /\b(services? gani|huduma gani|mnafanya nini|mnatoa nini|mna-?offer\w*|mnaofa\w*|what services|which services|what do you (do|offer)|services (do )?you (do )?offer|(uko|mko) nayo|kazi gani|(vitu|kazi|huduma) (gani )?mna(yo)?(fanya|toa|pea)|mnapea|services you offer|mn?a\w{2,} nini( specifically)?)\b/i;
// Follow-up on a services topic already open in this call ("which ones exactly?").
const FOLLOWUP = /\b(which|what exactly|specifically|zipi|gani|ipi|nini tena|tena)\b/i;
const topicOpen = (state) => Boolean(state?.v2Catalogue?.asks || state?.v2Catalogue?.listedCats);
const PRICE_ASK = /\b(bei|price|cost|how much|ngapi|pesa ngapi|charge)\b/i;
const EXPLAIN_ASK = /\b(ni nini|inahusisha|what (is|does)|what's included|includes?|explain|eleza|maana)\b/i;
const BOOK_ASK = /\b(book|ku-?book|nataka|i want|i need|nahitaji|tuweke|schedule)\b/i;
function wordsOf(s) { return String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !['usafi', 'clean', 'cleaning', 'kusafisha', 'standard', 'package', 'internal', 'service'].includes(w)); }
function matchEntry(text, sc) {
  const t = String(text || '').toLowerCase(); let best = null; let score = 0;
  for (const e of sc.entries) {
    const ws = [...new Set([...wordsOf(e.spoken.en), ...wordsOf(e.spoken.sw), ...wordsOf(e.raw?.name)])];
    const hit = ws.filter((w) => t.includes(w)).length;
    const s = hit ? hit + hit / ws.length : 0;
    if (s > score) { best = e; score = s; }
  }
  return best;
}
function matchCategory(text, sc) {
  const t = String(text || '').toLowerCase();
  return sc.categories.find((c) => [...wordsOf(c.en), ...wordsOf(c.sw)].some((w) => t.includes(w))) || null;
}
function commandFromText(text, sc, lang, state = {}) {
  const e = matchEntry(text, sc);
  const language = lang === 'sw' ? 'sw' : 'en';
  if (e && PRICE_ASK.test(text)) return { intent: 'price_service', service_id: e.id, language };
  if (e && EXPLAIN_ASK.test(text)) return { intent: 'explain_service', service_id: e.id, language };
  if (e && BOOK_ASK.test(text) && !SERVICES_ASK.test(text)) return { intent: 'book_service', service_id: e.id, language };
  if (SERVICES_ASK.test(text) || (topicOpen(state) && FOLLOWUP.test(text) && !e)) {
    const c = matchCategory(text, sc);
    if (c && sc.categories.length > 1) return { intent: 'list_category', category_id: c.id, language };
    if (e) return { intent: 'explain_service', service_id: e.id, language };
    return { intent: 'list_services', language };
  }
  return { intent: 'other', language };
}

// ---------- templates ----------
const T = {
  en: {
    list_cats: 'We do {{cats}}. Which one would you like?',
    list_all: 'All our services are {{items}}. Which one would you like?',
    list_cats_repeat: 'Sure, we do {{cats}}. Which of those would you like?',
    list_cats_again: 'For example, under {{cat}} we do {{items}}. Which one would you like?',
    list_items: 'Under {{cat}} we do {{items}}{{more}}. Which one would you like?',
    explain: '{{Explain}} The price is {{price}}. Would you like to book it?',
    explain_noprice: '{{Explain}} Would you like to book it?',
    explain_short: 'Yes, we do {{name}}, it is {{price}}. Would you like to book it?',
    price: '{{Name}} is {{price}}. Would you like to book it?',
  },
  sw: {
    list_cats: 'Tunafanya {{cats}}. Ungependa ipi?',
    list_all: 'Huduma zetu zote ni {{items}}. Ungependa ipi?',
    list_cats_repeat: 'Sawa, tunafanya {{cats}}. Ungependa ipi kati ya hizo?',
    list_cats_again: 'Kwa mfano, kwenye {{cat}} tunafanya {{items}}. Ungependa ipi?',
    list_items: 'Kwenye {{cat}} tunafanya {{items}}{{more}}. Ungependa ipi?',
    explain: '{{Explain}} Bei ni {{price}}. Ungependa kubook?',
    explain_noprice: '{{Explain}} Ungependa kubook?',
    explain_short: 'Ndio, tunafanya {{name}}, bei ni {{price}}. Ungependa kubook?',
    price: 'Bei ya {{name}} ni {{price}}. Ungependa kubook?',
  },
};
const CLOSE = { en: ['Would you like to book it?', 'Shall I book it for you?'], sw: ['Ungependa kubook?', 'Nikuwekee booking?'] };
class MissingSlot extends Error {}
function render(lang, key, slots) {
  return T[lang][key].replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const cap = /^[A-Z]/.test(k); const v = slots[k.toLowerCase()];
    if (v == null || v === '') { if (k === 'more') return ''; throw new MissingSlot(k); }
    return cap ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : String(v);
  });
}
const joinList = (xs, lang) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${lang === 'sw' ? 'na' : 'and'} ${xs[xs.length - 1]}`);

// ---------- step ----------
// state: per-call object; keeps what was listed so a repeat ask moves forward instead of re-dumping.
function decide({ command, sc, lang, state = {} }) {
  const L = lang === 'sw' ? 'sw' : 'en';
  const st = (state.v2Catalogue ||= { listedCats: 0, shownCats: [], asks: 0 });
  const trace = { step: 'catalogue', intent: command.intent, lang: L, commandLang: command.language };
  const entry = command.service_id ? sc.entries.find((e) => e.id === command.service_id) : null;
  const nm = (e) => e?.spoken?.[L] || null;
  const catName = (c) => c?.[L] || null;
  const vary = (line) => {
    const [a, b] = CLOSE[L];
    if (!line || !line.endsWith(a)) return line;
    st.closes = (st.closes || 0) + 1;
    return st.closes % 2 === 0 ? `${line.slice(0, -a.length)}${b}` : line;
  };
  const res = decideInner();
  return res.line ? { ...res, line: vary(res.line) } : res;
  function decideInner() {
  try {
    switch (command.intent) {
      case 'list_services': {
        const cats = sc.categories.filter((c) => catName(c));
        if (!cats.length) return { line: null, trace: { ...trace, yield: 'no_categories' } };
        st.asks += 1;
        const catLine = joinList(cats.slice(0, 4).map(catName), L);
        if (st.asks === 2) return { line: render(L, 'list_cats_repeat', { cats: catLine }), trace: { ...trace, template: 'list_cats_repeat' } };
        if (st.asks > 2) {
          const itemsOf = (c) => [...new Set(c.entryIds.map((id) => nm(sc.entries.find((e) => e.id === id))).filter(Boolean))].filter((x) => x !== catName(c));
          const multi = cats.filter((c) => itemsOf(c).length >= 2);
          const c = multi.find((x) => !st.shownCats.includes(x.id)) || multi[0];
          if (!c || st.shownCats.includes(c.id)) {
            const all = [...new Set(sc.entries.map(nm).filter(Boolean))].slice(0, 6);
            return { line: render(L, 'list_all', { items: joinList(all, L) }), trace: { ...trace, template: 'list_all' } };
          }
          st.shownCats.push(c.id);
          return { line: render(L, 'list_cats_again', { cat: catName(c), items: joinList(itemsOf(c).slice(0, 3), L) }), trace: { ...trace, template: 'list_cats_again', category: c.id } };
        }
        st.listedCats = 1;
        return { line: render(L, 'list_cats', { cats: catLine }), trace: { ...trace, template: 'list_cats' } };
      }
      case 'list_category': {
        const c = sc.categories.find((x) => x.id === command.category_id);
        const items = (c?.entryIds || []).map((id) => nm(sc.entries.find((e) => e.id === id))).filter(Boolean);
        if (!items.length) return { line: null, trace: { ...trace, yield: 'no_items' } };
        st.shownCats.push(c.id); st.listedCats = 1;
        return { line: render(L, 'list_items', { cat: catName(c), items: joinList(items.slice(0, 4), L), more: items.length > 4 ? (L === 'sw' ? ' na zaidi' : ', and more') : '' }), trace: { ...trace, template: 'list_items', category: c.id } };
      }
      case 'explain_service': {
        if (!nm(entry)) return { line: null, trace: { ...trace, yield: 'no_spoken_name' } };
        const ex = entry.explain?.[L];
        const key = ex ? (entry.price?.[L] ? 'explain' : 'explain_noprice') : 'explain_short';
        return { line: render(L, key, { name: nm(entry), explain: ex, price: entry.price?.[L] }), trace: { ...trace, template: key, service: entry.id } };
      }
      case 'price_service': {
        if (!nm(entry) || !entry.price?.[L]) return { line: null, trace: { ...trace, yield: 'no_price' } };
        return { line: render(L, 'price', { name: nm(entry), price: entry.price[L] }), trace: { ...trace, template: 'price', service: entry.id } };
      }
      default: return { line: null, trace: { ...trace, yield: 'not_catalogue' } };
    }
  } catch (e) {
    if (e instanceof MissingSlot) return { line: null, trace: { ...trace, yield: `missing_slot:${e.message}` } };
    throw e;
  }
  }
}

// Cheap gate so the step (and its model call) only runs on catalogue turns.
function looksCatalogue(text, profile, state = {}) {
  const t = String(text || '');
  if (SERVICES_ASK.test(t)) return true;
  if (topicOpen(state) && FOLLOWUP.test(t)) return true;
  if (!(PRICE_ASK.test(t) || EXPLAIN_ASK.test(t))) return false;
  return Boolean(matchEntry(t, resolveSpokenCatalogue(profile || {})));
}

// One call: pick the command (model if given and valid, else text rules), decide.
async function runCatalogueStep({ text, profile, lang, state = {}, model = null, timeoutMs = 700 }) {
  const sc = resolveSpokenCatalogue(profile || {});
  if (!sc.entries.length) return { line: null, trace: { step: 'catalogue', yield: 'empty_catalogue' } };
  let command = null; let source = 'rules'; let modelError = null;
  if (typeof model === 'function') {
    try {
      const resp = await Promise.race([model(buildCommandRequest({ text, sc, lang })), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
      const v = validateCommand(parseCommandResponse(resp), sc);
      if (v.ok) { command = v.command; source = 'model'; } else modelError = v.errors.slice(0, 2).join('; ');
    } catch (e) { modelError = String(e?.message || e).slice(0, 60); }
  }
  if (!command) command = validateCommand(commandFromText(text, sc, lang, state), sc).command || { intent: 'other', language: lang === 'sw' ? 'sw' : 'en' };
  const out = decide({ command, sc, lang, state });
  return { ...out, command, trace: { ...out.trace, source, modelError, scVersion: sc.version, scHash: sc.sourceHash.slice(0, 12) } };
}

module.exports = { looksCatalogue, catalogueStepEnabled, commandSchema, validateCommand, buildCommandRequest, parseCommandResponse, commandFromText, decide, render, runCatalogueStep, TEMPLATES: T };
