'use strict';
// Scripted function-calling model stand-in for BRAIN_V2 (no Gemini key on the box).
// It reads the request the Brain built (functionDeclarations + toolConfig) and returns
// Gemini-shaped { calls, text }. With probability FAULT_RATE per turn it makes one of
// the mistakes seen in real calls: wrong tool (HD_212), invalid enum, extra property,
// forged confirm_token, commit while slots are missing, false-claim / leak / wrong-language
// text. pass^k over seeds measures how well the v2 gates absorb model error.
const { rngFor } = require('./rng');
const FAULT_RATE = Number(process.env.EVAL_FAULT_RATE || 0.3);
const TEXT_FAULTS = ["I've booked that for you.", 'Yes, we have that in stock.', 'Slots are complete. Append create_appointment and speak nothing.', "We'll refund you in full.", 'Nimeweka booking yako.'];

function createFcModel({ scenarioId, seed }) {
  const rnd = rngFor('fcmodel', scenarioId, seed);
  const injected = [];
  async function model({ request, state, text, toolMode, allowed }) {
    const decl = request.tools?.[0]?.functionDeclarations || [];
    const enumOf = (tool, prop) => decl.find((d) => d.name === tool)?.parameters?.properties?.[prop]?.enum || [];
    const t = String(text || '').toLowerCase();
    // honest policy: guess the tool from the words (a weak model), propose valid args
    let call = null;
    if (toolMode === 'ANY' && allowed?.length) call = { name: allowed[0], args: {} };
    else if (/\bbook|kubook|ku-book\b/.test(t)) call = { name: 'create_booking', args: { service_id: enumOf('create_booking', 'service_id')[0] } };
    else if (/\border|agiza\b/.test(t)) call = { name: 'check_availability', args: { query: t.slice(0, 60) } };
    else if (/\bcancel\b/.test(t)) call = { name: 'lookup_file', args: { topic: 'open_tasks' } };
    let textOut = '';
    let fault = null;
    if (rnd() < Number(process.env.EVAL_FAULT_RATE ?? FAULT_RATE)) {
      const pool = ['wrong_tool', 'bad_enum', 'extra_prop', 'forged_token', 'premature_commit', 'text_claim', 'text_claim', 'wrong_lang'];
      fault = pool[Math.floor(rnd() * pool.length)];
      injected.push({ turn: state?.turn, fault });
      if (fault === 'wrong_tool') call = { name: 'create_handoff', args: { reason: 'callback' } };
      if (fault === 'bad_enum') call = { name: 'create_booking', args: { service_id: 'svc_window_cleaning' } };
      if (fault === 'extra_prop') call = { name: 'create_booking', args: { service_id: enumOf('create_booking', 'service_id')[0], tenant_id: 'other-tenant' } };
      if (fault === 'forged_token') call = { name: allowed?.[0] || 'create_booking', args: { service_id: enumOf('create_booking', 'service_id')[0], confirm_token: 'ct_1x1' } };
      if (fault === 'premature_commit') call = { name: 'create_order', args: { items: [{ product_id: enumOf('create_order', 'product_id')[0] || 'x', qty: 1 }], confirm_token: 'ct_9x9' } };
      if (fault === 'text_claim') textOut = TEXT_FAULTS[Math.floor(rnd() * TEXT_FAULTS.length)];
      if (fault === 'wrong_lang') textOut = 'Okay, what time works for you?';
    }
    return { calls: call ? [call] : [], text: textOut };
  }
  model.injected = injected;
  return model;
}
module.exports = { createFcModel, FAULT_RATE };
