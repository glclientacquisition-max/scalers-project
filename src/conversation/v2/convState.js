'use strict';
// BRAIN_V2_CONV_STATE (default off): Phase 1 of ship-briefs/2026-10-24_brain_turn-resolver-v2-design.md.
// The system owns the conversation state (state.conv); rules gaps are closed and hollow turns are
// inferred from that state, with no model. Off: nothing here runs.
//   pre(): after understand(), before routing. It only adjusts `u` (never speaks).
//   post(): after the turn line is decided. It tracks the open offer / service / repairs and turns
//           a 2nd consecutive repair into a callback offer (design §2.4, Alvin Q3 YES 24 Oct).
const R = require('./receipts');

const enabled = (env = process.env) => String(env.BRAIN_V2_CONV_STATE || '').trim().toLowerCase() === 'on';

const SERVICE_TTL = 3;   // turns a current service stays bindable for "it"
const OFFER_TTL = 2;     // turns an open offer stays answerable after the line moved on
const COVERAGE = /\b(coverage|cover(?:age)? area|areas? (?:you|do you) (?:cover|serve|work)|where do you (?:work|operate|go)|which places|mnafanyia wapi|mnafanya wapi|mnapatikana wapi)\b/i;
const NO_ANY = /\b(no|nope|nah|not now|not really|no thanks|definitely not|hapana|sitaki|la hasha|siwezi)\b/i;
const YES_WORD = /\b(yes|yeah|yep|sure|ok(?:ay)?|ndio|ndiyo|sawa)\b/i;
const ASK_WORD = /\b(how|what|where|when|which|much|price|cost|bei|ngapi|wapi|aje|gani)\b|\?/i;
const PRONOUN = /\b(it|that|this|them|those|yake|hiyo|hii|hizo)\b/i;
const REPAIR_HEAD = /^(sorry, i didn't catch that|samahani, sijakusikia vizuri)/i;
// [PROMPT-PLACEHOLDER] criteria: admit we did not understand twice, offer a team callback, one question.
const CALLBACK_AFTER_REPAIR = { en: "Sorry, I'm not getting that. Would you like the team to call you back?", sw: 'Samahani, sijakuelewa. Ungependa timu ikupigie?' };

function conv(state) {
  if (!state.conv) state.conv = { service: null, lastFact: null, offer: null, callback: { status: 'none' }, area: null, asks: [], repairCount: 0, diff: [] };
  return state.conv;
}
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/).filter(Boolean);

// a one-word "name" that is really a catalogue word ("Interior.")
function catalogueWord(text, profile) {
  const w = words(text);
  if (!w.length || w.length > 2) return null;
  const rows = (profile.servicesCatalog || []).filter((s) => w.every((x) => x.length >= 4 && words(s.name).includes(x)));
  return rows.length ? rows : null;
}

/** Adjust understanding from state. Returns the list of applied rules (traced). */
function pre(state, u, { text, profile = {} }) {
  const c = conv(state);
  const t = String(text || '');
  const applied = [];
  const turn = state.turn;
  const short = words(t).length <= 4;
  // gap: "what's your coverage?"
  if (COVERAGE.test(t) && !u.intents.includes('coverage')) { u.intents = [...u.intents.filter((i) => i !== 'unclear'), 'coverage']; applied.push('coverage'); }
  // gap: a no that is not the first word ("Definitely no.") in a short reply with no ask
  if (!u.no && short && NO_ANY.test(t) && !ASK_WORD.test(t) && !YES_WORD.test(t.replace(NO_ANY, ''))) { u.no = true; u.convNo = true; state._convNoTurn = state.turn; u.yes = false; u.place = null; u.area = null; u.nameCandidate = null; applied.push('no_any'); }
  // gap: a catalogue word answered to a name question is not a name
  if ((u.name || u.nameCandidate) && !u.intents.length && catalogueWord(t, profile)) {
    const rows = catalogueWord(t, profile);
    u.name = null; u.nameCandidate = null; if (rows.length === 1 && !u.service) u.service = rows[0];
    applied.push('not_a_name');
  }
  // state inference: "how much is it?" / "how is it done?" binds the current service
  if (!u.service && (u.intents.includes('price') || u.intents.includes('explain')) && c.service && turn - c.service.turn <= SERVICE_TTL && (PRONOUN.test(t) || short)) {
    const row = (profile.servicesCatalog || []).find((s) => s.name === c.service.name) || state.lastService;
    if (row) { u.service = row; applied.push('service_from_state'); }
  }
  // state inference: a yes/no after the line moved on still answers the open offer
  if ((u.yes || u.no) && !state.offer && c.offer && turn - c.offer.turn <= OFFER_TTL && state.phase !== 'readback' && !state.pending) {
    state.offer = c.offer.type; if (c.offer.service) state.offerService = c.offer.service;
    applied.push(`offer_reopened:${c.offer.type}`);
  }
  if (applied.length) state.trace.push({ turn, conv_pre: applied });
  return applied;
}

/** Track state after the line is decided; may replace a 2nd consecutive repair. */
function post(state, res) {
  const c = conv(state);
  const before = JSON.stringify({ s: c.service && c.service.name, o: c.offer && c.offer.type, r: c.repairCount, cb: c.callback.status });
  const turn = state.turn;
  const line = String(res?.line || '');
  // a clear "no" (e.g. "Definitely no.") to our own question is an answer, not noise: existing 'ack' line
  if (REPAIR_HEAD.test(line) && state._convNoTurn === turn && !state.pending && state.phase !== 'readback') {
    res.line = R.info({ kind: 'ack' }, state.lang || 'en'); state.lastLine = res.line; state.lastBase = res.line;
    if (c.offer) { if (c.offer.type === 'callback') c.callback = { ...c.callback, status: 'declined' }; c.offer = null; }
    c.repairCount = 0;
    state.trace.push({ turn, conv_post: 'no_as_answer' });
  } else if (REPAIR_HEAD.test(line) && !state.pending && state.phase !== 'readback') {
    c.repairCount += 1;
    if (c.repairCount >= 2 && c.callback.status !== 'declined') {
      const sw = /^sw/.test(state.lang || '');
      res.line = sw ? CALLBACK_AFTER_REPAIR.sw : CALLBACK_AFTER_REPAIR.en;
      state.offer = 'callback'; state.offerService = null; state.lastLine = res.line; state.lastBase = res.line;
      c.callback = { status: 'offered', reason: 'repair' };
      c.repairCount = 0;
      state.trace.push({ turn, conv_post: 'repair_to_callback' });
    }
  } else c.repairCount = 0;
  // the current service: renewed when this turn named one (or the name changed)
  if (state.lastService && (!c.service || c.service.name !== state.lastService.name || state.nluPrev?.service)) c.service = { name: state.lastService.name, turn };
  if (state.offer) {
    c.offer = { type: state.offer, service: state.offerService || null, turn };
    if (state.offer === 'callback' && c.callback.status === 'none') c.callback = { status: 'offered', reason: 'unknown_fact' };
  } else if (c.offer && turn - c.offer.turn > OFFER_TTL) c.offer = null;
  if ((state.outcomes || []).slice(-1)[0] === 'declined' && c.offer) { if (c.offer.type === 'callback') c.callback = { ...c.callback, status: 'declined' }; c.offer = null; }
  if (state.pending?.tool === 'create_handoff') c.callback = { ...c.callback, status: 'accepted' };
  const after = JSON.stringify({ s: c.service && c.service.name, o: c.offer && c.offer.type, r: c.repairCount, cb: c.callback.status });
  if (before !== after) state.trace.push({ turn, conv_diff: { from: JSON.parse(before), to: JSON.parse(after) } });
  return res;
}

module.exports = { enabled, pre, post, conv, COVERAGE, NO_ANY, CALLBACK_AFTER_REPAIR, SERVICE_TTL, OFFER_TTL };
