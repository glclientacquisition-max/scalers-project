'use strict';
// runTurnStream: the streaming contract Voice consumes (ba-v2-voice-scope §2.1).
// Yields only template lines (receipts.js), sentence-split; never model prose.
const { runTurn } = require('./machine');
const { buildCatalogue } = require('./catalogue');
const READS = new Set(['lookupFile', 'checkAvailability', 'getPrice', 'getHours']);
const clock = () => Number(process.hrtime.bigint() / 1000000n);
const WRITES = new Set(['createAppointment', 'createServiceRequest', 'updateAppointment', 'escalate', 'saveCallerInfo']);

// Never split inside a number ("4.30", "KSh 1.5k") or after an abbreviation ("St.", "a.m.", "No."):
// a split there makes Voice speak a fragment ("Hapana, n" class) and then the rest as a new line.
const ABBR = /(?:\b(?:st|mt|dr|mr|mrs|ms|no|rd|ave|approx|etc)|\b[ap]\.m|\b[a-z])\.$/i;
function splitSentences(line) {
  const raw = String(line || '').match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const out = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    const tight = prev && (/\d\.$/.test(prev) && /^\d/.test(s) || /\b[a-z]\.$/i.test(prev) && /^[a-z]\./i.test(s));
    if (prev && (tight || ABBR.test(prev) || /^[a-z]/.test(s))) out[out.length - 1] = `${prev}${tight ? '' : ' '}${s}`;
    else out.push(s);
  }
  return out;
}
function wrapHandlers(handlers = {}, push, now = () => 0) {
  const out = {};
  for (const [name, fn] of Object.entries(handlers)) {
    if (typeof fn !== 'function') { out[name] = fn; continue; }
    out[name] = async (args) => {
      const write = WRITES.has(name);
      // start is pushed BEFORE the handler is awaited so Voice can ack at once (relay item 1).
      const t0 = now(); push({ type: 'tool', phase: 'start', name, args, write });
      let receipt; try { receipt = await fn(args); } catch (e) { push({ type: 'tool', phase: 'end', name, write, receipt: { error: true }, toolMs: now() - t0 }); throw e; }
      push({ type: 'tool', phase: 'end', name, write, receipt, toolMs: now() - t0 });
      return receipt;
    };
  }
  return out;
}
// opts: same as runTurn ({text, profile, now, handlers, model, langLock, acked}) + shouldAbort().
// Every event carries atMs (ms since the turn started). Additive fields only:
// #681 consumers that ignore them keep working.
async function* runTurnStream(state, opts = {}) {
  const T0 = clock(); const now = () => clock() - T0;
  const q = []; let wake = null; let finished = false; let res; let err; let toolMs = 0;
  const push = (ev) => { if (ev.toolMs) toolMs += ev.toolMs; q.push({ ...ev, atMs: now() }); if (wake) { wake(); wake = null; } };
  const p = runTurn(state, { ...opts, handlers: wrapHandlers(opts.handlers, push, now) })
    .then((r) => { res = r; }, (e) => { err = e; }).finally(() => { finished = true; if (wake) { wake(); wake = null; } });
  while (true) {
    while (q.length) yield q.shift();
    if (finished) break;
    await new Promise((r) => { wake = r; });
  }
  await p; if (err) throw err;
  // Confirm-then-write hook: a read-back turn announces that the next "yes" commits.
  // Voice may run READ tools (prefetch) while the read-back plays; writes only happen
  // on the commit turn, inside runTurn, after the server-minted confirm_token matches.
  const awaitingConfirm = state.phase === 'readback' && !!state.pending;
  if (awaitingConfirm) yield { type: 'readback', tool: state.pending.tool, write: true, readsAllowed: [...READS], atMs: now() };
  const aborted = () => typeof opts.shouldAbort === 'function' && opts.shouldAbort();
  const said = []; let firstSentenceMs = null; const parts = splitSentences(res.line);
  for (const text of parts) {
    if (aborted()) break; // barge-in: stop sentences; tool effects already happened
    said.push(text); const atMs = now(); if (firstSentenceMs == null) firstSentenceMs = atMs;
    yield { type: 'sentence', text, lang: res.lang, source: res.source || 'receipt', atMs };
  }
  yield { type: 'done', end: !!res.end, ...(res.end ? { endReason: res.endReason || 'caller_done' } : {}), toolResults: res.toolResults || [], line: res.line, aborted: said.length < parts.length,
    awaitingConfirm, phase: state.phase, ackLed: !!state.lastAckLed, timing: { turnMs: now(), toolMs, firstSentenceMs }, atMs: now() };
}
// Prefetch for Voice at call start (relay item 4). Pure read of state + profile:
// no handler calls, no writes, safe in shadow and dry-run.
function prefetchContext(state, profile = {}) {
  return {
    catalogue: buildCatalogue({ profile, openRows: state.file.openRows }),
    callerFile: { contactName: state.file.contactName || null, openRows: state.file.openRows.map((r) => ({ ...r })), pendingTasks: (state.file.pendingTasks || []).length },
    hours: profile.hours || null, areas: profile.serviceAreas || profile.areas || null,
  };
}
module.exports = { runTurnStream, prefetchContext, splitSentences, WRITES, READS };
