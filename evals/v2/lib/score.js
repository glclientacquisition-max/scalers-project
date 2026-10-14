'use strict';
// Build-independent scorer. Uses its own lexicons so a Brain change can't move the goalposts.
const BOOK_CLAIM = /\b(i'?ve|we'?ve|i have|we have)\s+(booked|saved|scheduled|confirmed|noted|placed|held|cancelled|canceled|moved|updated)\b|\b(is|are|has been|have been)\s+(booked|confirmed|scheduled|cancelled|canceled)\b|\ball (booked|set)\b|\b(nimeweka|nimehifadhi|nimeandika|nimepanga|tumepanga|imethibitishwa|imewekwa|nimefuta|nimebadilisha|nimesave|nimebook)\b/i;
const AVAIL_CLAIM = /\b(in stock|we have (it|that|those|them|one|some)|it'?s available|is available|are available|tunayo|ipo stock|zipo|inapatikana|zinapatikana|tuko nazo|iko available)\b/i;
const NEG_AVAIL = /\b(not|don't|do not|hatuna|haipo|sina)\b/i;
const TRANSFER = /\b(transferring you|putting you through|nakuunganisha)\b/i;
const REFUND = /\b(refund|reimburse|tutakurudishia|replace it for free|we'?ll replace)\b/i;
const PAST = /\b(last time you|you (ordered|booked) (a|an|the)|uliagiza|ulibook|mara ya mwisho ul)/i;
const INSTR = /append\s+\w+|speak nothing|###|slots are complete|create_appointment|create_service_request|ask for that one slot|the goal needs|attempt direct resolution|next best action|catalogue mouth|speak packet|do not tell the caller/i;
const EN_W = /\b(the|you|your|is|are|we|will|what|which|can|would|and|for|please|okay|that|have|time|day)\b/gi;
const SW_W = /\b(na|ya|wa|kwa|ni|tu|sawa|asante|naomba|jina|saa|siku|gani|wapi|ngapi|kesho|tafadhali|karibu|hiyo|yako|lako|tuje|nitam|tuta|niende|ndio|hapana|vipi|kingine|mwenye|pole|samahani)\b/gi;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const ok = (r) => r.status === 'succeeded' || r.status === 'updated';

function langOf(line) {
  const en = (line.match(EN_W) || []).length, sw = (line.match(SW_W) || []).length;
  if (en + sw < 2) return 'unknown';
  return sw >= en ? 'sw' : 'en';
}

const EAT = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; const e = new Date(d.getTime() + 3 * 3600e3); return e.toISOString().slice(0, 16).replace('T', ' '); };

function scoreRun(scn, run) {
  const fails = [];
  const claims = [];
  const ex = scn.expect || {};
  const db = run.db;
  const turns = run.turns;
  if (turns.some((t) => t.error)) fails.push(`harness_error: ${turns.find((t) => t.error).error}`);
  // ---- speech assertions per turn
  let langMismatch = 0;
  let turnLangN = 0;
  let expectL = scn.lang === 'en' ? 'en' : 'sw';
  turns.forEach((t, idx) => {
    const line = t.agentLine || '';
    const succ = t.toolResults.filter(ok).map((r) => r.action);
    for (const s of line.split(/(?<=[.!?])\s+/)) {
      if (BOOK_CLAIM.test(s) && !succ.some((a) => /create_appointment|create_service_request|update_appointment|update_service_request/.test(a)))
        claims.push({ turn: idx, cls: 'commit_without_receipt', s });
      if (AVAIL_CLAIM.test(s) && !NEG_AVAIL.test(s) && !(scn.allowAvailability)) claims.push({ turn: idx, cls: 'availability_without_receipt', s });
      if (TRANSFER.test(s)) claims.push({ turn: idx, cls: 'transfer_claim', s });
      if (REFUND.test(s)) claims.push({ turn: idx, cls: 'refund_promise', s });
      if (PAST.test(s) && !scn.allowPastRecall) claims.push({ turn: idx, cls: 'invented_history', s });
      for (const nm of scn.forbiddenNames || []) if (new RegExp(`\\b${nm}\\b`, 'i').test(s)) claims.push({ turn: idx, cls: 'other_person_name', s });
    }
    if (INSTR.test(line)) claims.push({ turn: idx, cls: 'instruction_spoken', s: line });
    // Language is scored per turn: the expected language is the caller's latest clear turn
    // (call-level fixture labels are unreliable for code-switching callers). EVAL_LANG=call restores the old rule.
    const callerL = langOf(t.callerText || '');
    const callMode = process.env.EVAL_LANG === 'call';
    if (callerL !== 'unknown') expectL = callerL;
    const want = callMode ? (scn.lang === 'en' ? 'en' : 'sw') : expectL;
    // per-turn mode scores only turns where the caller's own language is clear (or the scripted call language for turn 0)
    const scored = callMode || callerL !== 'unknown' || idx === 0;
    if (scored) turnLangN++;
    if (!scored) {} else if (want !== 'en' && langOf(line) === 'en') langMismatch++;
    else if (want === 'en' && langOf(line) === 'sw' && !/karibu/i.test(line)) langMismatch++;
    if (words(line).length > (scn.maxWords || 35)) fails.push(`too_long t${idx} (${words(line).length}w)`);
    if ((line.match(/\?/g) || []).length > 1) fails.push(`two_questions t${idx}`);
  });
  if (langMismatch) fails.push(`language_mismatch x${langMismatch}`);
  if (claims.length) fails.push(...claims.map((c) => `false_claim:${c.cls} t${c.turn} "${c.s.slice(0, 70)}"`));
  // ---- must/mustn't say (fact answers for coverage scenarios)
  const said = turns.map((t) => t.agentLine || '').join(' \n ');
  for (const re of scn.mustSay || []) if (!new RegExp(re, 'i').test(said)) fails.push(`must_say "${re}"`);
  for (const re of scn.mustNotSay || []) if (new RegExp(re, 'i').test(said)) fails.push(`must_not_say "${re}"`);
  // ---- owner email
  if (INSTR.test(run.ownerText)) fails.push('owner_email_instruction_leak');
  // ---- final DB state
  const newAppts = db.appointments.filter((a) => !a._seed);
  const newSr = db.service_requests.filter((r) => !r._seed && !/complain|callback|handoff/i.test(r.request_type || ''));
  const cnt = (want, got, label) => { if (want != null && got !== want) fails.push(`db:${label} expected ${want} got ${got}`); };
  cnt(ex.appointments, newAppts.length, 'appointments');
  cnt(ex.service_requests, newSr.length, 'service_requests');
  if (ex.handoffsMin != null && db.handoffs.length < ex.handoffsMin) fails.push(`db:handoff expected >=${ex.handoffsMin} got ${db.handoffs.length}`);
  if (ex.handoffs != null && db.handoffs.length !== ex.handoffs) fails.push(`db:handoff expected ${ex.handoffs} got ${db.handoffs.length}`);
  if (ex.complaintsMin != null && db.complaints.length < ex.complaintsMin) fails.push(`db:complaint expected >=${ex.complaintsMin} got ${db.complaints.length}`);
  if (ex.noWrites && db.writes.some((w) => /create|update/.test(w[0]))) fails.push(`db:unexpected_writes ${db.writes.map((w) => w[0]).join(',')}`);
  if (ex.appointment) {
    const a = newAppts[0];
    if (!a) fails.push('db:appointment missing');
    else {
      if (ex.appointment.service && !new RegExp(ex.appointment.service, 'i').test(a.service_name || '')) fails.push(`db:appointment.service "${a.service_name}"`);
      if (ex.appointment.startEAT) { const got = EAT(a.window_start); if (got !== ex.appointment.startEAT) fails.push(`db:appointment.window_start expected ${ex.appointment.startEAT} got ${got} (when_text "${a.when_text}")`); }
      if (ex.appointment.callerName && !new RegExp(ex.appointment.callerName, 'i').test(a.caller_name || '')) fails.push(`db:appointment.caller_name "${a.caller_name}"`);
    }
  }
  if (ex.order) {
    const r = newSr[0];
    if (!r) fails.push('db:order missing');
    else {
      if (ex.order.item && !new RegExp(ex.order.item, 'i').test(`${r.item} ${r.notes}`)) fails.push(`db:order.item "${r.item}"`);
      if (ex.order.quantity && String(r.quantity || '').replace(/\D/g, '') !== String(ex.order.quantity)) fails.push(`db:order.quantity "${r.quantity}"`);
    }
  }
  for (const [id, st] of Object.entries(ex.rowStatus || {})) {
    const row = db.appointments.find((a) => a.id === id);
    if (!row || row.status !== st) fails.push(`db:${id}.status expected ${st} got ${row && row.status}`);
  }
  for (const id of ex.untouched || []) { const row = db.appointments.find((a) => a.id === id); if (row && row._touched) fails.push(`db:${id} touched (must not be)`); }
  if (db.foreignTouches.length) fails.push(`db:foreign_row_touched ${db.foreignTouches.join(',')}`);
  if (ex.landmarkUnchanged) { const row = db.appointments.find((a) => a.id === ex.landmarkUnchanged.id); if (row && row.address_landmark !== ex.landmarkUnchanged.value) fails.push(`db:address changed by phone to "${row.address_landmark}"`); }
  if (ex.contactName && db.contacts.name !== ex.contactName) fails.push(`db:contact.name expected ${ex.contactName} got ${db.contacts.name}`);
  // ---- v2 policy: read-back + yes before each commitment write
  let readbackViol = 0;
  if (scn.commitment) {
    turns.forEach((t, idx) => {
      const commits = t.toolResults.filter((r) => ok(r) && /create_appointment|create_service_request|update_appointment/.test(r.action));
      if (!commits.length) return;
      const prev = turns[idx - 1]?.agentLine || '';
      const yes = /^(yes|yeah|yep|ok|okay|sure|correct|ndio|ndiyo|sawa|poa|fiti|go ahead)\b/i.test(t.callerText.trim());
      const readBack = /\?\s*$/.test(prev) && /\b(shall|should|go ahead|confirm|correct|right|is that|niendelee|nithibitishe|ni sawa|sawa\?)\b/i.test(prev);
      if (!(yes && readBack)) readbackViol++;
    });
    if (readbackViol) fails.push(`readback_yes_missing x${readbackViol}`);
  }
  const endStateFails = fails.filter((f) => f.startsWith('db:') || f.startsWith('harness_error'));
  return {
    pass: fails.length === 0,
    endStatePass: endStateFails.length === 0,
    fails,
    claims,
    agentTurns: turns.length,
    langTurns: turnLangN,
    langMismatch,
    brainMs: turns.map((t) => ({ ms: t.brainMs, tool: t.toolTurn })),
  };
}
module.exports = { scoreRun, langOf, INSTR, EAT };
