'use strict';
// BRAIN_ENGINES commit gate (invariant): the caller hears "booked" / "callback set" / "request saved"
// ONLY after the write returned ok WITH a row id, and a write receipt was recorded for it.
//   - commitWrite(): the only way the engines path writes. Re-checks slot preconditions (never writes with a
//     missing slot), records receipts (confirmed -> committed | failed), and on failure saves exactly ONE owner
//     request record per call. The owner alert is sent only after a request row exists.
//   - enforceCommitTruth(): the single response-path check. Any non-question sentence that claims a write
//     (booked, I've asked the owner, they'll call you, nimekuwekea, atakupigia, ...) is dropped unless the
//     call ledger holds a committed write of that kind. Applies to model, fixed and receipt lines alike.
const CS = require('./commitSafety');
const CC = require('./callCore');
const { missingSlots } = require('./enginePreconditions');

const CLAIM_EXTRA = /\b(?:i have|i'?ve got|i got|i'?ve noted|i noted)\s+(?:got\s+)?your\b.{0,60}?\b(?:booking|request|order|appointment|callback|visit)\b|\b(?:i'?ve|i have|i) (?:asked|told|informed|notified|left|sent|passed|saved|booked|scheduled|logged)\b|\b(?:request|callback|booking|order|message) (?:is |has been )?(?:saved|sent|set|logged|placed|booked|confirmed)\b|\b(?:will|'ll) (?:call|ring|phone|text|contact|reach) you\b|\b(?:nimemwomba|nimemwambia|nimempa|nimemwachia|nimehifadhi|nimeweka|nimekuwekea|nimetuma|imehifadhiwa|limehifadhiwa|atakupigia|atakupigie|watakupigia|tutakupigia|imekamilika)\b/i;

function claimKind(sentence) {
  const s = String(sentence || '').trim();
  if (!s || /\?\s*$/.test(s)) return null; // a question offers, it does not claim
  if (!(CC.CLAIM.test(s) || CLAIM_EXTRA.test(s))) return null;
  if (/\b(book|booked|booking|nimekuwekea|miadi|appointment|visit)\b/i.test(s)) return 'booking';
  return 'request';
}

/** Ledger kinds that back a claim. 'request' is backed by any committed callback or owner request row. */
function backed(kind, ledger = []) {
  const ok = (e) => e && e.ok === true && !!e.id && !!e.receiptKey;
  if (kind === 'booking') return ledger.some((e) => ok(e) && e.tool === 'create_booking');
  return ledger.some((e) => ok(e) && (e.tool === 'create_handoff' || e.tool === 'owner_request' || e.tool === 'create_booking'));
}

/** -> { kept: [{text, src}], dropped: [{text, reason}] } */
function enforceCommitTruth(sentences, ledger = []) {
  const kept = []; const dropped = [];
  for (const s of sentences) {
    const kind = claimKind(s.text);
    if (kind && !backed(kind, ledger)) dropped.push({ text: s.text, reason: `unbacked_claim:${kind}` });
    else kept.push(s);
  }
  return { kept, dropped };
}

function engState(machine) {
  if (!machine.eng) machine.eng = { ledger: [], fallback: null, pending: null, asks: {}, lang: null, offered: null, nameRefusals: 0 };
  return machine.eng;
}

async function runWrite(p, handlers) {
  if (p.tool === 'create_booking') {
    if (!handlers?.createAppointment) return { ok: false, id: null, error: 'no_handler' };
    return handlers.createAppointment({
      idempotencyKey: p.idemKey,
      serviceName: p.service,
      whenText: `${p.when.date} ${p.when.time}`,
      landmark: p.place,
      name: p.name,
      phone: p.phone,
    });
  }
  if (p.tool === 'create_handoff' || p.tool === 'owner_request') {
    if (!handlers?.createServiceRequest) return { ok: false, id: null, error: 'no_handler' };
    return handlers.createServiceRequest({ idempotencyKey: p.idemKey, type: 'callback', name: p.name, phone: p.phone, notes: p.notes || `Callback: ${p.reason || 'caller asked'}` });
  }
  return { ok: false, id: null, error: 'unknown_tool' };
}

function summary(p) {
  if (p.tool === 'create_booking') return `booking ${p.service || ''} ${p.when?.date || ''} ${p.when?.time || ''} ${p.place || ''}`.replace(/\s+/g, ' ').trim();
  return `callback (${p.alertReason || p.reason || 'caller asked'})`;
}

/**
 * The only engines write. -> { status: 'committed'|'failed_fallback_saved'|'failed_nothing_saved'|'blocked',
 *   id, fallbackId, notified, missing }
 */
async function commitWrite({ p, machine, handlers, profile = {}, notify, callerPhone, log = () => {} }) {
  const E = engState(machine);
  const missing = missingSlots(p.tool, machine, { profile, callerPhone });
  if (missing.length) return { status: 'blocked', missing };
  const record = CS.makeRecorder(handlers, machine);
  record('confirmed', p, { confirmedTurn: machine.turn });
  let res = null;
  try { res = await runWrite(p, handlers); } catch (e) { res = { ok: false, id: null, error: String(e?.message || e) }; }
  const ok = !!(res && res.ok === true && res.id);
  if (ok) {
    const rec = record('committed', p, { writeId: res.id, writeTable: p.tool === 'create_booking' ? 'appointments' : 'service_requests' });
    E.ledger.push({ tool: p.tool, ok: true, id: res.id, receiptKey: rec.idempotencyKey, turn: machine.turn });
    let notified = false;
    if (p.tool === 'create_handoff' && typeof notify === 'function') {
      try { const nr = await notify({ reason: p.alertReason || p.reason, name: p.name, phone: p.phone }); notified = !!(nr && (nr.ok || nr.duplicate)); } catch { notified = false; }
    }
    return { status: 'committed', id: res.id, notified };
  }
  const code = res?.error || (res && res.ok && !res.id ? 'no_row_id' : 'write_failed');
  const frec = record('failed', p, { errorCode: String(code).slice(0, 60) });
  E.ledger.push({ tool: p.tool, ok: false, id: null, receiptKey: frec.idempotencyKey, error: code, turn: machine.turn });
  log(`[brain_engines] write failed tool=${p.tool} code=${code}`);
  // exactly ONE owner request record per call; the alert only after it is saved
  if (E.fallback) return { status: E.fallback.ok ? 'failed_fallback_saved' : 'failed_nothing_saved', fallbackId: E.fallback.id || null, notified: !!E.fallback.notified, error: code };
  const fp = { tool: 'owner_request', kind: 'callback', reason: `not_saved:${p.tool}`, name: p.name, phone: p.phone, notes: `Not saved on the call (${code}): ${summary(p)}. Please call the caller back.`, idemKey: `${p.idemKey}:owner_request`, token: p.token, issuedTurn: p.issuedTurn };
  E.fallback = { ok: false, id: null, notified: false };
  if (missingSlots('owner_request', machine, { profile, callerPhone }).length) return { status: 'failed_nothing_saved', error: code };
  let fr = null;
  try { fr = await runWrite(fp, handlers); } catch (e) { fr = { ok: false, id: null, error: String(e?.message || e) }; }
  const fok = !!(fr && fr.ok === true && fr.id);
  E.fallback = { ok: fok, id: fok ? fr.id : null, notified: false };
  const rp = { ...fp, tool: 'create_handoff', kind: 'callback' };
  if (!fok) { record('failed', rp, { errorCode: String(fr?.error || 'owner_request_failed').slice(0, 60) }); return { status: 'failed_nothing_saved', error: code }; }
  const rrec = record('committed', rp, { writeId: fr.id, writeTable: 'service_requests' });
  E.ledger.push({ tool: 'owner_request', ok: true, id: fr.id, receiptKey: rrec.idempotencyKey, turn: machine.turn });
  if (typeof notify === 'function') {
    try { const nr = await notify({ reason: fp.reason, name: fp.name, phone: fp.phone }); E.fallback.notified = !!(nr && (nr.ok || nr.duplicate)); } catch { E.fallback.notified = false; }
  }
  return { status: 'failed_fallback_saved', fallbackId: fr.id, notified: E.fallback.notified, error: code };
}

module.exports = { commitWrite, enforceCommitTruth, claimKind, backed, engState, CLAIM_EXTRA };
