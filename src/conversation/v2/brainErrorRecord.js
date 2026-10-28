'use strict';
// B2 follow-up: an owner must never lose a caller because the brain errored.
//
// When an engines turn throws (a model, a tool or the turn itself), the caller hears the v2 repair line and the
// call is saved for the owner through the SAME commit path as a callback request: one service_requests row
// (type callback, via the live handlers -> applyTools -> executor, which also fires the owner's new-request alert
// on the saved row), with the caller's number and whatever reason or slots are known. C1 write receipts record
// it (confirmed -> committed | failed), and the engines ledger carries it, so machine.finishCall reports the
// typed outcome `brain_error` (saved) or `write_failed` (the save itself failed) and the hangup
// `call.summary.ready` event carries that outcome for Ops' owner alert.
//
// Idempotent per call: one record per call state (state.eng.brainError), concurrent errors share one promise,
// and an owner request already saved on this call (the engines' not-saved fallback) is reused, never doubled.
// Never throws, never says "booked": the spoken line is the repair line, decided by the caller of this module.
const CS = require('./commitSafety');
const { engState } = require('./engineCommit');

const KINDS = new Set(['model', 'tool', 'turn', 'voice']);

function errorKind(err, fallback = 'turn') {
  const k = err && err.brainErrorKind;
  if (KINDS.has(k)) return k;
  const msg = String((err && err.message) || err || '');
  if (/gemini|model|generativelanguage|stream|quota|429|503|deadline/i.test(msg)) return 'model';
  if (/tool|handler|applyTools|executor|createServiceRequest|createAppointment|supabase|insert/i.test(msg)) return 'tool';
  return KINDS.has(fallback) ? fallback : 'turn';
}

function known(machine = {}) {
  const s = machine.slots || {};
  const when = s.when && (s.when.date || s.when.time) ? [s.when.date, s.when.time].filter(Boolean).join(' ') : null;
  const items = Array.isArray(s.items) && s.items.length ? s.items.map((x) => `${x.qty || '?'} x ${x.name}`).join(', ') : null;
  const p = machine.pending || machine.eng?.pending || null;
  return {
    name: s.name || null,
    phone: s.phone || machine.callerPhone || null,
    service: s.service || p?.service || null,
    when,
    place: s.place || p?.place || null,
    items,
    intent: machine.intent || machine.eng?.flow?.tool || null,
  };
}

function notesFor(kind, k, lastCaller) {
  const bits = [
    k.intent ? `asked: ${k.intent}` : null,
    k.service ? `service: ${k.service}` : null,
    k.items ? `items: ${k.items}` : null,
    k.when ? `when: ${k.when}` : null,
    k.place ? `place: ${k.place}` : null,
    lastCaller ? `last said: "${String(lastCaller).slice(0, 140)}"` : null,
  ].filter(Boolean);
  return `Live line could not complete (brain_error:${kind}). Please call the caller back.${bits.length ? ` Known: ${bits.join('; ')}.` : ''}`;
}

/**
 * Save the brain-error follow-up once per call.
 * @returns {Promise<{ok:boolean,id:string|null,kind:string,reused?:boolean,error?:string,once:boolean}>}
 */
async function recordBrainError({ machine, handlers, err, kind: kindIn, callSid = null, lastCaller = null, log = () => {}, onRecord = null, notify = null } = {}) {
  if (!machine || typeof machine !== 'object') return { ok: false, id: null, kind: 'turn', error: 'no_state', once: false };
  const E = engState(machine);
  if (E.brainErrorP) { const r = await E.brainErrorP; return { ...r, once: false }; }
  const kind = errorKind(err, kindIn);
  const message = String((err && err.message) || err || '').slice(0, 160);
  E.brainErrorP = (async () => {
    // The engines already saved this call's one owner request (a failed write's fallback): reuse it.
    if (E.fallback && E.fallback.ok && E.fallback.id) {
      E.brainError = { ok: true, id: E.fallback.id, kind, reused: true, at: machine.turn || 0 };
      log(`[brain_engines] brain_error kind=${kind} reused owner_request id=${E.fallback.id}`);
      return { ...E.brainError };
    }
    const k = known(machine);
    const p = {
      tool: 'owner_request',
      kind: 'callback',
      reason: `brain_error:${kind}`,
      name: k.name,
      phone: k.phone,
      notes: notesFor(kind, k, lastCaller),
      idemKey: `${callSid || machine.callSid || 'call'}:brain_error`,
      token: null,
      issuedTurn: machine.turn || 0,
    };
    const rp = { ...p, tool: 'create_handoff' };
    const record = CS.makeRecorder(handlers, machine);
    record('confirmed', rp, { confirmedTurn: machine.turn || 0, reason: p.reason });
    let res = null;
    try {
      if (!handlers || typeof handlers.createServiceRequest !== 'function') throw new Error('no_handler');
      res = await handlers.createServiceRequest({ idempotencyKey: p.idemKey, type: 'callback', name: p.name, phone: p.phone, notes: p.notes });
    } catch (e) {
      res = { ok: false, id: null, error: String((e && e.message) || e).slice(0, 60) };
    }
    const ok = !!(res && res.ok === true && res.id);
    if (ok) {
      const rec = record('committed', rp, { writeId: res.id, writeTable: 'service_requests', reason: p.reason });
      E.ledger.push({ tool: 'owner_request', ok: true, id: res.id, receiptKey: rec.idempotencyKey, reason: 'brain_error', turn: machine.turn || 0 });
      E.fallback = { ok: true, id: res.id, notified: false };
      if (typeof notify === 'function') {
        try { const nr = await notify({ reason: p.reason, name: p.name, phone: p.phone }); E.fallback.notified = !!(nr && (nr.ok || nr.duplicate)); } catch { E.fallback.notified = false; }
      }
      E.brainError = { ok: true, id: res.id, kind, at: machine.turn || 0, message };
      log(`[brain_engines] brain_error kind=${kind} saved owner_request id=${res.id}`);
    } else {
      const code = String(res?.error || (res && res.ok && !res.id ? 'no_row_id' : 'write_failed')).slice(0, 60);
      const frec = record('failed', rp, { errorCode: code, reason: p.reason });
      E.ledger.push({ tool: 'owner_request', ok: false, id: null, receiptKey: frec.idempotencyKey, reason: 'brain_error', error: code, turn: machine.turn || 0 });
      E.brainError = { ok: false, id: null, kind, at: machine.turn || 0, message, error: code };
      log(`[brain_engines] brain_error kind=${kind} save FAILED code=${code}: owner follow-up not saved`);
    }
    if (typeof onRecord === 'function') { try { onRecord({ ...E.brainError }); } catch { /* trace only */ } }
    return { ...E.brainError };
  })();
  const r = await E.brainErrorP;
  return { ...r, once: true };
}

module.exports = { recordBrainError, errorKind };
