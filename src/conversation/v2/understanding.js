'use strict';
// ENGINE 1: one typed understanding per turn (BRAIN_ENGINES). Fallback never returns empty.
const N = require('./nlu');
const L = require('./lexicon');
const AC = require('./areaCoverage');
const CP = require('./callPlan');

const YES_PAT = /^\W*(yes|yeah|yep|yup|sure|correct|right|ok(?:ay)?|of course|go ahead|please do|that'?s (me|right)|ndio|ndiyo|ndiye|sawa|eeh|naam|ni mimi|ni sahihi|kabisa|haya|poa|endelea)\b/i;
const CALLBACK_YES = /\b(nipigie|kunipigia|mtanipigia|mnanipigia|unipigie|utamwambia|watakupigia|call me back|call you back)\b/i;

const SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['book', 'ask', 'confirm', 'deny', 'cancel', 'callback', 'handoff', 'goodbye', 'smalltalk', 'identity', 'unknown'] },
    answers: { type: 'array', items: { type: 'string', enum: ['coverage', 'price', 'hours', 'services', 'payment', 'policy', 'identity', 'booking_status', 'other'] } },
    yes_no: { type: 'string', enum: ['yes', 'no', 'unknown'], nullable: true },
    slots: {
      type: 'object',
      properties: {
        service: { type: 'string', nullable: true },
        place: { type: 'string', nullable: true },
        day: { type: 'string', nullable: true },
        time: { type: 'string', nullable: true },
        name: { type: 'string', nullable: true },
      },
    },
    language: { type: 'string', enum: ['en', 'sw'], nullable: true },
    wants_human: { type: 'boolean', nullable: true },
    closing: { type: 'boolean', nullable: true },
  },
  required: ['intent', 'answers'],
  propertyOrdering: ['intent', 'answers', 'yes_no', 'slots', 'language', 'wants_human', 'closing'],
};

const SYSTEM = [
  'Read ONE caller turn on a Kenyan business phone line. Return ONLY JSON matching the schema.',
  'intent: what they want now. answers: every open question they asked (coverage, price, hours, etc.).',
  'yes_no: yes/no/null. Swahili and English affirmatives include sawa, ndio, eeh, poa, yes, okay.',
  'A line like "Sawa. Wewe utamwambia nipigie?" is yes to a callback offer (yes_no=yes).',
  'slots.place: every place named, resolved to the business area tree when possible.',
  'language: en or sw for this turn. wants_human when they ask for a person. closing when they are done.',
].join('\n');

function emptyUnderstanding() {
  return { intent: 'unknown', answers: [], yes_no: null, slots: {}, language: null, wants_human: false, closing: false, source: 'empty' };
}

function detectYesNo(text, machine = {}) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (CP.isYes(t) || CALLBACK_YES.test(t)) return 'yes';
  if (/^\W*(no|nope|hapana|si mimi|sio)\b/i.test(t)) return 'no';
  if (machine.phase === 'readback' && machine.pending && YES_PAT.test(t)) return 'yes';
  return null;
}

function resolvePlace(raw, profile) {
  if (!raw) return null;
  const r = AC.resolve(String(raw), profile);
  return (r && r.name) || String(raw).trim() || null;
}

function fromNlu(text, profile, machine, now) {
  const nu = N.understand(String(text || ''), { profile, now, expecting: machine.expecting || null });
  const answers = [];
  if (nu.intents?.includes('coverage') || nu.place || nu.area) answers.push('coverage');
  if (nu.intents?.includes('price')) answers.push('price');
  if (nu.intents?.includes('hours')) answers.push('hours');
  if (nu.intents?.includes('services')) answers.push('services');
  if (nu.intents?.includes('payment')) answers.push('payment');
  let intent = 'ask';
  if (nu.yes) intent = 'confirm';
  else if (nu.no) intent = 'deny';
  else if (nu.intents?.includes('book')) intent = 'book';
  else if (nu.intents?.includes('callback') || nu.intents?.includes('handoff')) intent = 'callback';
  else if (nu.intents?.includes('goodbye')) intent = 'goodbye';
  const slots = {};
  if (nu.service?.name) slots.service = nu.service.name;
  const place = nu.place || (nu.area && nu.area.name);
  if (place) slots.place = resolvePlace(place, profile);
  if (nu.when?.date) slots.day = nu.when.date;
  if (nu.when?.time) slots.time = nu.when.time;
  if (nu.name) slots.name = nu.name;
  else if (nu.nameCandidate) slots.name = nu.nameCandidate;
  const lang = L.isSw(text) ? 'sw' : 'en';
  const yes_no = detectYesNo(text, machine) || (nu.yes ? 'yes' : nu.no ? 'no' : null);
  return {
    intent,
    answers: [...new Set(answers)],
    yes_no,
    slots,
    language: lang,
    wants_human: /\b(human|person|manager|owner|mwenye biashara|meneja|speak to)\b/i.test(text),
    closing: /\b(bye|goodbye|asante tu|that'?s all|nishamaliza)\b/i.test(text),
    source: 'fallback',
  };
}

function validate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const intent = String(raw.intent || 'unknown');
  const answers = Array.isArray(raw.answers) ? raw.answers.map(String) : [];
  const slotsIn = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
  const slots = {
    service: slotsIn.service ? String(slotsIn.service) : null,
    place: slotsIn.place ? String(slotsIn.place) : null,
    day: slotsIn.day ? String(slotsIn.day) : null,
    time: slotsIn.time ? String(slotsIn.time) : null,
    name: slotsIn.name ? String(slotsIn.name) : null,
  };
  const lang = raw.language === 'sw' ? 'sw' : raw.language === 'en' ? 'en' : null;
  let yes_no = raw.yes_no === 'yes' || raw.yes_no === 'no' ? raw.yes_no : null;
  if (yes_no === null && raw.yes_no === 'unknown') yes_no = null;
  return {
    intent,
    answers,
    yes_no,
    slots,
    language: lang,
    wants_human: raw.wants_human === true,
    closing: raw.closing === true,
    source: 'model',
  };
}

function understandRequest({ text, machine, profile }) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ CALLER_SAID: String(text || ''), EXPECTING: machine.expecting || null, AGENT_LAST: String(machine.lastLine || '').slice(0, 200), BUSINESS: profile?.businessName || null }) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json', responseSchema: SCHEMA, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
  };
}

/** One primary model call; no backup race. Waits up to hardMs; partial JSON accepted when complete object parses. */
async function runUnderstanding({ text, machine, profile, streamFor, modelId, hardMs = 1500, clock = () => Date.now(), log = () => {} }) {
  const now = new Date();
  let parsed = null;
  let outcome = 'skipped';
  if (streamFor && modelId) {
    const t0 = clock();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), hardMs);
    try {
      let buf = '';
      const res = await streamFor(modelId)({ request: understandRequest({ text, machine, profile }), signal: ac.signal, onText: (d) => { buf += d; } });
      if (res && res.text) buf = res.text;
      try { parsed = validate(JSON.parse(buf)); outcome = parsed ? 'ok' : 'invalid_json'; } catch { outcome = 'invalid_json'; }
      if (!parsed && buf.length > 2) {
        const m = buf.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = validate(JSON.parse(m[0])); if (parsed) outcome = 'ok'; } catch { /* */ } }
      }
      if (!parsed) log(`[brain_engines] understanding ${outcome} ms=${clock() - t0}`);
    } catch (e) {
      outcome = /abort/i.test(String(e)) ? 'timeout' : 'error';
      log(`[brain_engines] understanding ${outcome}: ${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!parsed) {
    parsed = fromNlu(text, profile, machine, now);
    parsed.fallbackReason = outcome;
  }
  if (parsed.slots?.place) parsed.slots.place = resolvePlace(parsed.slots.place, profile);
  const yn = detectYesNo(text, machine);
  if (yn && !parsed.yes_no) parsed.yes_no = yn;
  if (!parsed.language) parsed.language = L.isSw(text) ? 'sw' : 'en';
  return parsed;
}

/** Map engines fallback/model shape to BRAIN_MODEL_LEAD split understanding (normUnderstanding input). */
function toLeadShape(fb) {
  if (!fb) return null;
  const intents = [];
  if (fb.intent === 'book') intents.push('book');
  if (fb.intent === 'callback' || fb.intent === 'handoff') intents.push('callback');
  if (fb.intent === 'cancel') intents.push('cancel');
  if (fb.intent === 'confirm') intents.push('confirm');
  if (fb.intent === 'deny') intents.push('deny');
  if (fb.intent === 'goodbye') intents.push('goodbye');
  if (!intents.length) intents.push('ask');
  const qmap = { coverage: 'coverage', price: 'price', hours: 'hours', services: 'services', payment: 'payment', identity: 'identity', booking_status: 'booking_status', policy: 'policy', other: 'other' };
  const questions = (fb.answers || []).map((a) => ({ type: qmap[a] || 'other' }));
  const places = fb.slots?.place ? [fb.slots.place] : [];
  return {
    lang: fb.language === 'sw' ? 'sw' : fb.language === 'en' ? 'en' : 'mix',
    intents,
    questions,
    places,
    slots: {
      services: fb.slots?.service ? [fb.slots.service] : [],
      date: fb.slots?.day || null,
      time: fb.slots?.time || null,
      name: fb.slots?.name || null,
      places,
    },
    confirms_pending: fb.yes_no === 'yes' ? true : fb.yes_no === 'no' ? false : null,
    source: fb.source || 'fallback',
  };
}

module.exports = {
  SCHEMA,
  emptyUnderstanding,
  detectYesNo,
  fromNlu,
  validate,
  understandRequest,
  runUnderstanding,
  resolvePlace,
  toLeadShape,
};
