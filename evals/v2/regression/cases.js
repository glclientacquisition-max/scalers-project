'use strict';
// Regression-9: the nine known bugs from the Oct 15-16 calls as permanent EN + SW cases.
// Synthetic and anonymised: shapes only (intent order, slots, language); fixture tenants,
// fixture names, no prod transcripts, phones or caller data. Source of the bug list:
// research/oct16-call-review.md, briefs/fix-forever-brain.md, eval/nlu-gap-spec.md §6.
//
// kind 'call'  -> driven through the v2 harness (evals/v2/lib/driver.js, BRAIN_V2 on) k times.
// kind 'probe' -> a direct check against a module (Voice-side code).
// xfail: { owner, note } -> the fix is in another lane; a failure is reported XFAIL and does
// not fail the run; a pass is reported XPASS so the owner can drop the xfail.
const BANNED = [
  [/^\W*(sawa|okay|ok|alright|sure)\W*$/i, 'bare_ack_only'],
  [/\bregarding\s+[A-Z]|\bkuhusu\s+[A-Z][a-z]+\s*\?/, 'regarding_X'],
];
const lines = (run) => run.turns.map((t) => t.agentLine || '');
const LIST = /\b(sofas?|sofa cleaning)\b.*\b(carpets?|carpet cleaning)\b|\bwe (do|offer)\b.*,.*,|\btunafanya\b.*,.*,/i;
const SAVED = /\b(saved|booked|placed|nimehifadhi|nimeweka|imehifadhiwa)\b/i;
const MUT = new Set(['create_order', 'create_service_request', 'create_appointment']);

// generic-reply lint used by every call case (bug 5 class)
function lint(run) {
  const f = [];
  lines(run).forEach((l, i) => { for (const [re, tag] of BANNED) if (re.test(l)) f.push(`${tag} t${i} "${l}"`); });
  return f;
}
// no mutating write unless the previous agent line was a read-back question and the caller said yes
function writeNeedsReadback(run) {
  const f = [];
  run.turns.forEach((t, i) => {
    if (!t.toolResults.some((x) => MUT.has(x.action) && x.status === 'succeeded')) return;
    const prev = run.turns[i - 1]?.agentLine || '';
    if (!/\?\s*$/.test(prev) || !/(shall i|nithibitishe|confirm|book it|niendelee)/i.test(prev)) f.push(`write_without_readback t${i}`);
  });
  return f;
}
const t = (run, i) => run.turns[i]?.agentLine || '';

module.exports = [
  // 1. HD_69f53a46339b T2: a named service + date + place got the service list
  { bug: 1, id: 'R1_en_book_outranks_list', title: 'Clear booking request gets a list (HD_69f53a46339b)', kind: 'call', lang: 'en', tenant: 'done_and_dusted',
    turns: [['Which service do you offer? I want deep cleaning tomorrow, Kilimani.', 'What services do you do? I need deep cleaning tomorrow in Kilimani.']],
    facts: { name: 'Alvin', when: 'tomorrow at 10am', place: 'Kilimani' },
    check: (r) => [...(LIST.test(t(r, 0)) ? [`listed_services "${t(r, 0)}"`] : []), ...(r.db.appointments.length === 1 && /deep/i.test(r.db.appointments[0].service_name || '') ? [] : ['no_deep_cleaning_booking'])] },
  { bug: 1, id: 'R1_sw_book_outranks_list', title: 'Clear booking request gets a list (HD_69f53a46339b)', kind: 'call', lang: 'sw', tenant: 'done_and_dusted',
    turns: [['Mnafanya huduma gani? Nataka deep cleaning kesho Kilimani.', 'Mnafanya nini? Nataka deep cleaning kesho Kilimani.']],
    facts: { name: 'Wanjiru', when: 'kesho saa nne asubuhi', place: 'Kilimani' },
    check: (r) => [...(LIST.test(t(r, 0)) ? [`listed_services "${t(r, 0)}"`] : []), ...(r.db.appointments.length === 1 && /deep/i.test(r.db.appointments[0].service_name || '') ? [] : ['no_deep_cleaning_booking'])] },

  // 2. Identity-question loop: a pending ask must not be repeated over the caller's question
  { bug: 2, id: 'R2_en_no_repeat_ask_over_question', title: 'Identity / slot question repeated over a real question (HD_2847152f6c1e T2-T3, Brain side)', kind: 'call', lang: 'en', tenant: 'done_and_dusted',
    turns: ['I want to book carpet cleaning on Friday at 10am.', 'Do you come to Kitengela?'], facts: { name: 'Alvin', place: 'Kitengela' },
    check: (r) => {
      const f = [];
      const q = (l) => (String(l).match(/[^.?!]*\?/g) || []).map((s) => s.trim().toLowerCase());
      for (let i = 1; i < r.turns.length; i++) for (const s of q(t(r, i))) if (q(t(r, i - 1)).includes(s)) f.push(`repeated_question t${i} "${s}"`);
      if (!/kitengela/i.test(t(r, 1))) f.push(`question_not_answered "${t(r, 1)}"`);
      return f;
    } },
  { bug: 2, id: 'R2_sw_no_repeat_ask_over_question', title: 'Identity / slot question repeated over a real question (HD_2847152f6c1e T2-T3, Brain side)', kind: 'call', lang: 'sw', tenant: 'done_and_dusted',
    turns: ['Nataka kubook usafi wa carpet Ijumaa saa nne asubuhi.', 'Mnakuja Kitengela?'], facts: { name: 'Otieno', place: 'Kitengela' },
    check: (r) => {
      const f = [];
      const q = (l) => (String(l).match(/[^.?!]*\?/g) || []).map((s) => s.trim().toLowerCase());
      for (let i = 1; i < r.turns.length; i++) for (const s of q(t(r, i))) if (q(t(r, i - 1)).includes(s)) f.push(`repeated_question t${i} "${s}"`);
      if (!/kitengela/i.test(t(r, 1))) f.push(`question_not_answered "${t(r, 1)}"`);
      return f;
    } },

  // 3. HD_2847152f6c1e T4: order saved on a bare "Yes, yes." with no item, stock answer or read-back
  { bug: 3, id: 'R3_en_no_order_on_bare_yes', title: 'Order saved with no read-back or stock check (HD_2847152f6c1e)', kind: 'call', lang: 'en', tenant: 'retail_shop', allowAvailability: true,
    turns: ['I wanted to order a set.', 'Do you have the engineering set?', 'Yes, yes.'], facts: {},
    check: (r) => [...(r.db.service_requests.length ? ['order_saved_for_unknown_item'] : []), ...lines(r).filter((l) => SAVED.test(l) && !/haven't saved|sijahifadhi/i.test(l)).map((l) => `claimed_saved "${l}"`), ...(/which item/i.test(t(r, 1)) ? [`stock_question_ignored "${t(r, 1)}"`] : [])] },
  { bug: 3, id: 'R3_sw_no_order_on_bare_yes', title: 'Order saved with no read-back or stock check (HD_2847152f6c1e)', kind: 'call', lang: 'sw', tenant: 'retail_shop', allowAvailability: true,
    turns: ['Nataka kuagiza seti.', 'Mko na engineering set?', 'Ndio, ndio.'], facts: {},
    check: (r) => [...(r.db.service_requests.length ? ['order_saved_for_unknown_item'] : []), ...lines(r).filter((l) => SAVED.test(l) && !/sijahifadhi/i.test(l)).map((l) => `claimed_saved "${l}"`), ...(/kitu gani/i.test(t(r, 1)) ? [`stock_question_ignored "${t(r, 1)}"`] : [])] },
  { bug: 3, id: 'R3_en_known_item_needs_readback', title: 'Order saved with no read-back or stock check (HD_2847152f6c1e), positive path', kind: 'call', lang: 'en', tenant: 'retail_shop', commitment: true, allowAvailability: true,
    turns: ['Do you have diaries?', 'I want to order 2 diaries, I will pick them up tomorrow.'], facts: { name: 'Brian', when: 'tomorrow at 10am', quantity: '2', item: 'diaries' },
    expect: { service_requests: 1, appointments: 0, order: { item: 'diar', quantity: 2 } } },
  { bug: 3, id: 'R3_sw_known_item_needs_readback', title: 'Order saved with no read-back or stock check (HD_2847152f6c1e), positive path', kind: 'call', lang: 'sw', tenant: 'retail_shop', commitment: true, allowAvailability: true,
    turns: ['Mko na diary?', 'Nataka kuagiza diary mbili, nitazichukua kesho.'], facts: { name: 'Achieng', when: 'kesho saa tano asubuhi', quantity: 'mbili', item: 'diary' },
    expect: { service_requests: 1, appointments: 0, order: { item: 'diar' } } },

  // 4. HD_740090e11a2f T2: a bare name read as a topic ("How can I help you regarding Chris?")
  { bug: 4, id: 'R4_en_bare_name', title: "Bare name read as a topic (HD_740090e11a2f 'Chris.')", kind: 'call', lang: 'en', tenant: 'done_and_dusted',
    turns: [['Chris.', 'Chris']], facts: {}, check: (r) => (r.state.slots.name === 'Chris' ? [] : [`name_not_taken ${r.state.slots.name}`]) },
  { bug: 4, id: 'R4_sw_bare_name', title: "Bare name read as a topic (HD_740090e11a2f 'Chris.')", kind: 'call', lang: 'sw', tenant: 'done_and_dusted',
    turns: [['Ni Wanjiru.', 'Mimi ni Wanjiru.']], facts: {}, check: (r) => (r.state.slots.name === 'Wanjiru' ? [] : [`name_not_taken ${r.state.slots.name}`]) },

  // 5. Generic replies: bare Sawa/Okay, "regarding X", re-listing after a Yes
  { bug: 5, id: 'R5_en_no_relist_after_yes', title: "Generic replies (bare Sawa, 'regarding X', relist after Yes)", kind: 'call', lang: 'en', tenant: 'done_and_dusted',
    turns: ['How much is sofa cleaning?', 'Yes.'], facts: {}, check: (r) => (LIST.test(t(r, 1)) || /how can i help/i.test(t(r, 1)) ? [`generic_after_yes "${t(r, 1)}"`] : []) },
  { bug: 5, id: 'R5_sw_no_relist_after_yes', title: "Generic replies (bare Sawa, 'regarding X', relist after Yes)", kind: 'call', lang: 'sw', tenant: 'done_and_dusted',
    turns: ['Bei ya sofa ni ngapi?', 'Ndio.'], facts: {}, check: (r) => (LIST.test(t(r, 1)) || /tukusaidie vipi/i.test(t(r, 1)) ? [`generic_after_yes "${t(r, 1)}"`] : []) },

  // 6-9: Voice-side (src/speech, server.js). Probes on the Voice seams; required (Voice fixes:
  // R6 outageDebounce.decideSpeechOutage, R7 callerFileSpeech.shouldAskFileName, R8 toolSmooth.shouldQueueHold
  // + TurnArbiter audio slot, R9 prepareForTts line language + per-language lexicon).
  { bug: 6, id: 'R6_stale_stream_not_outage', title: 'False speech outage + owner SMS on one stale TTS stream (HD_30a3970034a4)', kind: 'probe', lang: 'en+sw',
    probe: (root) => {
      const { classifySonioxError } = require(`${root}/src/speech/sonioxErrors`);
      const c = classifySonioxError({ error_code: 400, error_message: 'Stream abc123 not found' });
      const f = c.fatal || c.billing ? ['classifier_marks_stale_stream_fatal'] : [];
      let seam = null; try { seam = require(`${root}/src/speech/speechOutageNotify`).shouldDeclareSpeechOutage; } catch { /* absent */ }
      if (typeof seam !== 'function') f.push('no_outage_decision_seam');
      else if (seam([{ code: 400, message: 'Stream abc123 not found' }])) f.push('single_stale_stream_declared_outage');
      return f;
    } },
  { bug: 7, id: 'R7_name_gate_no_repeat_over_question', title: 'Name-gate repeats "Am I speaking with <name>?" over a real question (HD_2847152f6c1e T3)', kind: 'probe', lang: 'en+sw',
    probe: (root) => {
      const m = require(`${root}/src/speech/callerFileSpeech`);
      if (typeof m.shouldAskFileName !== 'function') return ['no_name_gate_seam'];
      const f = [];
      for (const q of ['Do you have the engineering set?', 'Mko na engineering set?']) if (m.shouldAskFileName({ askedTurns: 1, callerText: q })) f.push(`repeat_name_ask "${q}"`);
      return f;
    } },
  { bug: 8, id: 'R8_no_stacked_filler_and_hold', title: 'Filler + hold line + receipt stacked on a tool turn (HD_2847152f6c1e T4)', kind: 'probe', lang: 'en+sw',
    probe: (root) => {
      const m = require(`${root}/src/speech/toolSmooth`);
      const f = [];
      // HD_2847 T4 shape: the "Mm-hmm." filler already played, tool still pending, filler ends now
      let q;
      try { q = m.shouldQueueHold({ toolPending: true, remainingMs: 0, played: 0, fillerPlayed: true }); } catch (e) { q = `error ${e.message}`; }
      if (q !== false) f.push(`hold_queued_after_filler -> ${JSON.stringify(q)}`);
      return f;
    } },
  { bug: 9, id: 'R9_sw_place_not_respelled', title: 'Swahili place name respelled with English phonetics ("Na-koo-roo", HD_740090e11a2f)', kind: 'probe', lang: 'sw',
    probe: (root) => {
      const { prepareForTts } = require(`${root}/src/speech/ttsNormalize`);
      const s = 'Tuko na matawi matatu Nakuru, Nairobi na Mombasa.';
      const f = [];
      for (const o of [{ callLanguage: 'sw' }, {}]) {
        const r = prepareForTts(s, o);
        if (/[A-Za-z]+-[a-z]+-[a-z]+/.test(r.text) || !/Nakuru/.test(r.text)) f.push(`respelled ${JSON.stringify(o)} "${r.text}"`);
        if (r.language !== 'sw') f.push(`detected_${r.language}_for_sw_line ${JSON.stringify(o)}`);
      }
      return f;
    } },
];
module.exports.lint = lint;
module.exports.writeNeedsReadback = writeNeedsReadback;
