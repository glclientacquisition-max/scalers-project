'use strict';
// BRAIN_ENGINES fixed lines. Only two kinds of line are fixed templates on the engines path:
//   1) the read-back (what the caller says yes to), from the shared receipts.readback (one source, EN + SW);
//   2) the outcome line of a write: booked / callback set (only from a committed write with a row id),
//      or the honest failure line (what was actually saved, nothing more).
// Everything else the caller hears is model-written (engineReply), checked by the guard.
// noModelFallback() is the total fallback when the model is unavailable; it is never mixed into a model reply.
const R = require('./receipts');
const L = require('./lexicon');
const CS = require('./commitSafety');

const sw = (lang) => L.isSw(lang);

function readbackLine(p, lang) {
  // B1 safe mode: name, number and reason read back together (the only fixed line before the yes)
  if (p.safe) return require('./safeMode').readbackLine(p, lang);
  // B1 NO_HOURS_BOOKING_AS_REQUEST: a booking request for the team to confirm (no slot is offered as available)
  if (p.request === 'booking') return bookingRequestLine(p, lang);
  const rb = R.readback(p, lang);
  // the callback read-back also says the name it will be saved under, so the yes confirms the name too
  if (p.tool === 'create_handoff' && p.name && rb) return `${p.name}, ${rb.charAt(0).toLowerCase()}${rb.slice(1)}`;
  return rb;
}

/** B1: "Shall I ask the team to confirm a time for the deep clean, Thursday at 10:00, and call you back on ...?" */
function bookingRequestLine(p, lang) {
  const S = sw(lang);
  const svc = p.service ? R.svcName(p.service, lang) : null;
  const w = p.preferred || {};
  const when = w.date ? `${L.sayDate(w.date, lang)}${w.time ? (S ? ` ${L.sayTime(w.time, lang)}` : ` at ${w.time}`) : ''}` : (w.time ? (S ? L.sayTime(w.time, lang) : `at ${w.time}`) : null);
  const num = p.phoneSaid ? (S ? ` kwa namba ${p.phoneSaid}` : ` on ${p.phoneSaid}`) : (S ? ' kwa namba hii' : ' on this number');
  const nm = p.name ? `${p.name}, ` : '';
  if (S) return `${nm}nimwombe mwenye biashara athibitishe muda${svc ? ` wa ${svc}` : ''}${when ? `, ${when}` : ''}, na akupigie${num}. Ni sawa?`;
  return `${nm}shall I ask the team to confirm a time${svc ? ` for the ${svc.toLowerCase()}` : ''}${when ? `, ${when}` : ''}, and call you back${num}?`;
}

/** One yes/no re-ask of the same read-back (Alvin: unclear answer = one yes/no re-ask). */
function reaskLine(p, lang) {
  const own = p && (p.safe || p.request === 'booking') ? readbackLine(p, lang) : null;
  const q = own ? (own.match(/[^.!?]+\?\s*$/) || [own])[0].trim().replace(/^[^,]*,\s*(?=(shall|nimwombe))/i, '') : (R.reaskQ(p, lang) || '');
  return sw(lang)
    ? `Samahani, sikusikia vizuri. Tafadhali sema ndio au hapana: ${q ? q.charAt(0).toLowerCase() + q.slice(1) : 'niendelee?'}`
    : `Sorry, I didn't catch that. Please say yes or no: ${q ? q.charAt(0).toLowerCase() + q.slice(1) : 'shall I go ahead?'}`;
}

/** Spoken only after commitWrite returned ok with a row id and a receipt. */
function committedLine(p, lang) {
  const S = sw(lang);
  if (p.tool === 'create_booking') {
    const svc = R.svcName(p.service, lang);
    const when = `${L.sayDate(p.when.date, lang)}${p.when.time ? (S ? ` ${L.sayTime(p.when.time, lang)}` : ` at ${p.when.time}`) : ''}`;
    return S
      ? `Imekamilika, nimekuwekea ${svc}, ${when}${p.place ? `, ${p.place}` : ''}. Kuna kingine?`
      : `Done, your ${svc.toLowerCase()} is booked for ${when}${p.place ? ` in ${p.place}` : ''}. Anything else?`;
  }
  if (p.tool === 'create_handoff') {
    const who = p.kind === 'manager' ? (S ? 'meneja' : 'the manager') : (S ? 'mwenye biashara' : 'the owner');
    const num = p.phoneSaid ? (S ? ` kwa ${p.phoneSaid}` : ` on ${p.phoneSaid}`) : '';
    const when = p.callbackWhen ? ` ${p.callbackWhen.say(lang)}` : '';
    return S
      ? `Tayari, nimemwomba ${who} akupigie${num},${when}. Kuna kingine?`.replace(',.', '.')
      : `Done, I've asked ${who} to call you${num},${when}. Anything else?`.replace(',.', '.');
  }
  return '';
}

/**
 * Honest failure line. status: 'failed_fallback_saved' (the owner request row exists) or
 * 'failed_nothing_saved' (nothing was saved and no alert was sent).
 */
function failedLine(p, status, lang) {
  const S = sw(lang);
  const what = p.tool === 'create_booking' ? (S ? 'booking' : 'the booking') : (S ? 'ombi la kupigiwa simu' : 'the callback');
  const num = p.phoneSaid ? (S ? ` kwa ${p.phoneSaid}` : ` on ${p.phoneSaid}`) : '';
  if (status === 'failed_fallback_saved') {
    return S
      ? `Samahani, ${what} haikuhifadhiwa. Nimemwachia mwenye biashara ujumbe akupigie${num}.`
      : `Sorry, ${what} didn't save. I've left the owner a note to call you${num}.`;
  }
  return S
    ? 'Samahani, sikuweza kuhifadhi hilo sasa hivi. Tafadhali piga simu tena baadaye kidogo.'
    : "Sorry, I couldn't save that just now. Please call us again a little later.";
}

/** Total fallback only (model unavailable). Shared ask table, never a placeholder tag. */
function noModelFallback(goal, lang, { n = 0, machine = {}, receiptText = null } = {}) {
  if (receiptText) return receiptText;
  if (goal.type === 'ask') {
    if (goal.slot === 'time') {
      const d = machine.slots?.when?.date;
      return R.ask('time', n, lang, { day: d ? L.sayDate(d, lang) : (sw(lang) ? 'siku hiyo' : 'that day') });
    }
    if (goal.slot === 'change') return sw(lang) ? 'Ungependa kubadilisha nini?' : 'No problem, what would you like to change?';
    if (goal.slot === 'name' && goal.why === 'callback') {
      return sw(lang) ? 'Naomba jina lako, ili mwenye biashara ajue anampigia nani?' : 'May I have your name, so the owner knows who to call?';
    }
    if (['service', 'date', 'place', 'name'].includes(goal.slot)) return R.ask(goal.slot, n, lang);
    // B1 safe mode slots (total fallback only; the response engine words these when the model is up)
    if (goal.slot === 'phone') return sw(lang) ? 'Naomba namba ya simu tukupigie?' : 'What number should the team call you back on?';
    if (goal.slot === 'reason') return sw(lang) ? 'Ungependa mwenye biashara akupigie kuhusu nini?' : 'What would you like the team to call you about?';
  }
  if (goal.type === 'close') return R.info({ kind: 'bye' }, lang);
  if (goal.type === 'no_name') {
    return sw(lang)
      ? 'Bila jina siwezi kumwachia mwenye biashara ombi. Unaweza kupiga tena wakati wa saa za kazi.'
      : "Without a name I can't leave the owner a request. You're welcome to call again during working hours.";
  }
  return R.ask('intent', n, lang);
}

function sayPhone(phone) { return CS.sayPhone(phone); }

module.exports = { readbackLine, reaskLine, committedLine, failedLine, noModelFallback, sayPhone };
