'use strict';
// BRAIN_V2 turn loop for the harness: same fake DB / scoring contract as driver.js, but the
// Brain is src/conversation/v2 (typed catalogue, state machine, receipts, owner templates)
// and the model is the function-calling stand-in (fcModel.js).
const path = require('path');
const { createFcModel } = require('./fcModel');

async function runCallV2({ root, profile, seed, callerPhone = '+254700000001', caller, maxTurns = 14, now, businessName, scenarioId = 'x', modelSeed = 1, fcModel }, createFakeDb) {
  const V2 = require(path.join(root, 'src/conversation/v2'));
  const { db, handlers } = createFakeDb(seed, callerPhone);
  const openRows = (seed?.appointments || []).filter((a) => a.caller_phone === callerPhone);
  const state = V2.createState({ profile, callerPhone, contactName: seed?.contactName || null, openRows, pendingTasks: seed?.pendingTasks || [] });
  const model = fcModel || createFcModel({ scenarioId, seed: modelSeed });
  const turns = [];
  const all = [];
  let lastAgentText = '';
  for (let i = 0; i < maxTurns; i++) {
    const text = caller({ i, lastAgentText, turns, state });
    if (text == null) break;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    const t0 = process.hrtime.bigint();
    let modelNs = 0n; let error = null; let r = { line: '', toolResults: [], lang: 'en' };
    const timedModel = async (a) => { const m0 = process.hrtime.bigint(); try { return await model(a); } finally { modelNs += process.hrtime.bigint() - m0; } };
    // Driven through runTurnStream so the run carries what the caller hears (sentence /
    // readback / tool events with atMs) for lib/heard.js; done mirrors runTurn's result.
    let events = [];
    try {
      for await (const ev of V2.runTurnStream(state, { text: clean, profile, now, handlers, model: timedModel })) events.push(ev);
      const d = events.at(-1) || {}; const sl = events.find((e) => e.type === 'sentence');
      r = { line: d.line || '', toolResults: d.toolResults || [], lang: sl?.lang || state.lang || 'en', end: !!d.end };
    }
    catch (e) { error = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); }
    const brainMs = Number(process.hrtime.bigint() - t0 - modelNs) / 1e6;
    all.push(...r.toolResults);
    lastAgentText = r.line;
    turns.push({ i, callerText: clean, agentLine: r.line, outcome: 'v2', toolResults: r.toolResults.map((x) => ({ action: x.action, status: x.status, code: x.code })), language: r.lang, brainMs, toolTurn: r.toolResults.length > 0, error, events: events.map(({ type, phase, name, write, text, lang, atMs, toolMs }) => ({ type, phase, name, write, text, lang, atMs, toolMs })) });
    if (error || r.end) break;
  }
  const fin = V2.finishCall(state, { businessName, callerPhone });
  db.contacts.finalStateName = state.slots.name || null;
  return { turns, db, state, ownerText: fin.ownerText, results: all, modelFaults: model.injected || [], trace: state.trace };
}
module.exports = { runCallV2 };
