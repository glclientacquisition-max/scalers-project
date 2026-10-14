'use strict';
// runTurnStream: the streaming contract Voice consumes (ba-v2-voice-scope §2.1).
// Yields only template lines (receipts.js), sentence-split; never model prose.
const { runTurn } = require('./machine');
const WRITES = new Set(['createAppointment', 'createServiceRequest', 'updateAppointment', 'escalate', 'saveCallerInfo']);

function splitSentences(line) {
  return String(line || '').match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) || [];
}
function wrapHandlers(handlers = {}, push) {
  const out = {};
  for (const [name, fn] of Object.entries(handlers)) {
    if (typeof fn !== 'function') { out[name] = fn; continue; }
    out[name] = async (args) => {
      const write = WRITES.has(name);
      push({ type: 'tool', phase: 'start', name, args, write });
      let receipt; try { receipt = await fn(args); } catch (e) { push({ type: 'tool', phase: 'end', name, write, receipt: { error: true } }); throw e; }
      push({ type: 'tool', phase: 'end', name, write, receipt });
      return receipt;
    };
  }
  return out;
}
// opts: same as runTurn ({text, profile, now, handlers, model, langLock}) + shouldAbort().
async function* runTurnStream(state, opts = {}) {
  const q = []; let wake = null; let finished = false; let res; let err;
  const push = (ev) => { q.push(ev); if (wake) { wake(); wake = null; } };
  const p = runTurn(state, { ...opts, handlers: wrapHandlers(opts.handlers, push) })
    .then((r) => { res = r; }, (e) => { err = e; }).finally(() => { finished = true; if (wake) { wake(); wake = null; } });
  while (true) {
    while (q.length) yield q.shift();
    if (finished) break;
    await new Promise((r) => { wake = r; });
  }
  await p; if (err) throw err;
  const aborted = () => typeof opts.shouldAbort === 'function' && opts.shouldAbort();
  const said = [];
  for (const text of splitSentences(res.line)) {
    if (aborted()) break; // barge-in: stop sentences; tool effects already happened
    said.push(text); yield { type: 'sentence', text, lang: res.lang, source: res.source || 'receipt' };
  }
  yield { type: 'done', end: !!res.end, toolResults: res.toolResults || [], line: res.line, aborted: said.length < splitSentences(res.line).length };
}
module.exports = { runTurnStream, splitSentences, WRITES };
