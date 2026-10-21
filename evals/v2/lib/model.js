'use strict';
// Scripted LLM stand-in ("noisy model"). No LLM key is available on the box, so the
// model side is a seeded policy that behaves like the current marker-protocol Gemini:
// it reads the Brain state the prompt would carry, asks the next slot, emits ###TOOL###
// markers, and with probability FAULT_RATE per turn makes one of the mistakes seen in
// real calls (HD_212 wrong tool, premature "booked", ungrounded stock claim, English in a
// Swahili call, instruction leak, two questions, invented refund). pass^k over seeds
// therefore measures how robust the Brain gates are to model error.
const { rngFor } = require('./rng');
const FAULT_RATE = Number(process.env.EVAL_FAULT_RATE || 0.3);
const v = (e) => (e && typeof e === 'object' ? e.value : e) || '';
const SW = (l) => /^(sw|sheng|mixed)/.test(String(l || ''));

const ASK = {
  en: { name: 'May I have your name?', when: 'What day and time works for you?', time: 'What time would you like?', location: 'Where should we come?', landmark: 'Where should we come?', area: 'Which area is that?', quantity: 'How many would you like?', service: 'What do you need done?', item: 'Which item would you like?', reason: 'How can I help you today?', confirm: 'Shall I go ahead?' },
  sw: { name: 'Naomba jina lako?', when: 'Siku gani na saa ngapi?', time: 'Saa ngapi ingekufaa?', location: 'Tuje wapi?', landmark: 'Tuje wapi?', area: 'Ni eneo gani?', quantity: 'Ngapi?', service: 'Ungependa tufanye nini?', item: 'Ungependa kitu gani?', reason: 'Tukusaidie vipi?', confirm: 'Niendelee?' },
};
const FAULTS = {
  premature_claim: { en: "I've booked that for you.", sw: 'Nimeweka booking yako.' },
  availability: { en: 'Yes, we have that in stock.', sw: 'Ndio, tunayo hiyo.' },
  leak_instr: { en: 'Slots are complete. Append create_appointment and speak nothing.', sw: 'Slots are complete. Append create_appointment and speak nothing.' },
  refund: { en: "We'll refund you in full.", sw: 'Tutakurudishia pesa zako zote.' },
  two_q: { en: 'Anything else? Would you like a reminder?', sw: 'Kuna kingine? Ungependa ukumbusho?' },
};

const isVisit = (state) => /^(booking|book_visit)$/.test(String(state.intent || '')) && String(state.vertical || '').includes('home');
function marker(obj) { return `###TOOL###\n${JSON.stringify(obj)}\n###ENDTOOL###`; }

function createModel({ scenarioId, seed }) {
  const rnd = rngFor('model', scenarioId, seed);
  const injected = [];
  function model({ i, state, decision, text, language }) {
    const L = SW(language) ? 'sw' : 'en';
    const action = String(decision?.action || '');
    const slot = String(decision?.slot || '');
    const e = state.entities || {};
    const name = state.caller?.name || v(e.name);
    let fault = null;
    if (rnd() < Number(process.env.EVAL_FAULT_RATE ?? FAULT_RATE)) {
      const pool = ['premature_claim', 'availability', 'wrong_lang', 'leak_instr', 'two_q', 'refund'];
      if (action === 'CREATE_REQUEST' && isVisit(state)) pool.push('wrong_tool', 'wrong_tool');
      fault = pool[Math.floor(rnd() * pool.length)];
      injected.push({ turn: i, fault });
    }
    const LL = fault === 'wrong_lang' ? 'en' : L;
    let spoken = '';
    let tool = '';
    if (action === 'ASK_CLARIFICATION') spoken = ASK[LL][slot] || ASK[LL].reason;
    else if (action === 'CREATE_REQUEST') {
      const intent = String(state.intent || '');
      const when = v(e.when) || v(e.time) || v(e.day);
      const place = v(e.location) || v(e.landmark) || v(e.area) || v(e.place);
      if (/cancel/.test(intent) && /\b(cancel|futa|ondoa)\b/i.test(text) || /\b(cancel|futa|ondoa)\b/i.test(text)) tool = marker({ update_appointment: { status: 'cancelled', notes: text } });
      else if (false || /\b(cancel|futa|ondoa)\b/i.test(text)) tool = marker({ update_appointment: { status: 'cancelled', notes: text } });
      else if (/resched|change|move/.test(intent)) tool = marker({ update_appointment: { when_text: when, notes: text } });
      else if (isVisit(state) && fault !== 'wrong_tool') tool = marker({ create_appointment: { service_name: v(e.service), name, location: place, when_text: when } });
      else if (isVisit(state)) tool = marker({ create_service_request: { type: 'hold', item: v(e.service), name, when_text: '' } });
      else tool = marker({ create_service_request: { type: /order|hold/.test(intent) ? 'order' : intent || 'enquiry', item: v(e.item) || v(e.product) || v(e.service), quantity: v(e.quantity), name, when_text: when } });
      spoken = '';
    } else if (action === 'ESCALATE') {
      tool = marker({ escalate: { reason: v(e.reason) || text, name } });
      spoken = LL === 'sw' ? 'Nitamjulisha mwenye biashara.' : "I'll let the owner know.";
    } else if (action === 'END') spoken = LL === 'sw' ? 'Asante, kwaheri.' : 'Thank you, goodbye.';
    else if (/\b(cancel|futa|ondoa booking)\b/i.test(text)) { tool = marker({ update_appointment: { status: 'cancelled', notes: text } }); spoken = ''; }
    else if (/\b(move|reschedule|badilisha siku|shift)\b/i.test(text) && (v(e.when) || /\b(to|hadi)\b/i.test(text))) { tool = marker({ update_appointment: { when_text: v(e.when) || text, notes: text } }); spoken = ''; }
    else if (/\b(stock|have|available|tunayo|mna|iko|zipo|ipo)\b/i.test(text) && /\?|have|mna/i.test(text)) spoken = LL === 'sw' ? 'Ngoja nithibitishe na mwenye duka.' : 'Let me confirm that with the owner.';
    else spoken = LL === 'sw' ? 'Sawa. Tukusaidie na nini kingine?' : 'Okay. What else can I help with?';
    if (fault && FAULTS[fault]) spoken = `${FAULTS[fault][LL]} ${spoken}`.trim();
    return [spoken, tool].filter(Boolean).join('\n');
  }
  model.injected = injected;
  return model;
}

module.exports = { createModel, FAULT_RATE };
