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
const { isReadbackQuestion } = require('../lib/readback');
const lines = (run) => run.turns.map((t) => t.agentLine || '');
const LIST = /\b(sofas?|sofa cleaning)\b.*\b(carpets?|carpet cleaning)\b|\bwe (do|offer)\b.*,.*,|\btunafanya\b.*,.*,/i;
const SAVED = /\b(saved|booked|placed|nimehifadhi|nimeweka|imehifadhiwa)\b/i;
const DENY = /\b(do not|don'?t|doesn'?t) (offer|have|do)\b|not on our list|hatufanyi|hatuna|haipo kwenye orodha/i;
const NAME_ASK = /\b(may i have your name|what is your name|your name again|naomba jina|jina lako ni nani)\b/i;
const NOT_SAVED = /\b(do not|don'?t) have your name|not have your name saved|sina jina lako/i;
const BAD_SW = /\b(nikuvishe|nkusaidie|aje leo)\b/i;
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
    if (!isReadbackQuestion(prev)) f.push(`write_without_readback t${i}`);
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

  // 6-9: Voice-side (src/speech, server.js). Probes on the Voice modules; xfail where the fix or
  // a test seam is Voice's.
  { bug: 6, id: 'R6_stale_stream_not_outage', title: 'False speech outage + owner SMS on one stale TTS stream (HD_30a3970034a4)', kind: 'probe', lang: 'en+sw',
    xfail: { owner: 'Voice', note: 'the race is in server.js speakText/outage path; needs a Voice test seam (e.g. an exported shouldDeclareSpeechOutage(errors)) that counts a single stale "Stream … not found" as non-fatal' },
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
    xfail: { owner: 'Voice', note: 'canned file_name_ask lives in server.js; needs an exported name-gate decision (e.g. callerFileSpeech.shouldAskFileName({askedTurns, callerTextIsQuestion})) so EN "Do you have the engineering set?" / SW "Mko na engineering set?" suppress the repeat' },
    probe: (root) => {
      const m = require(`${root}/src/speech/callerFileSpeech`);
      if (typeof m.shouldAskFileName !== 'function') return ['no_name_gate_seam'];
      const f = [];
      for (const q of ['Do you have the engineering set?', 'Mko na engineering set?']) if (m.shouldAskFileName({ askedTurns: 1, callerText: q })) f.push(`repeat_name_ask "${q}"`);
      return f;
    } },
  { bug: 8, id: 'R8_no_stacked_filler_and_hold', title: 'Filler + hold line + receipt stacked on a tool turn (HD_2847152f6c1e T4)', kind: 'probe', lang: 'en+sw',
    xfail: { owner: 'Voice', note: 'toolSmooth must not queue the hold line when a filler already played this turn; needs shouldQueueHold to take the filler state (#687 follow-up)' },
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
    xfail: { owner: 'Voice', note: 'live respelling came from the phonetic/lexicon path with a Swahili call language; prepareForTts must keep Kenyan places as written in sw and detect the line as sw' },
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

  // ---- HD_b4396ad63677 (Jirani staging, 17 Oct): Brain-owned causes, synthetic replays ----
  // Tenant: fixtures/tenants/synthetic_cleaner.json (fictional "Mtaa Bora Cleaning Services"), built
  // to the same spoken-catalogue shape: "deep cleaning, like move-in or after building work".
  { bug: 'J-B1', id: 'JB1_en_after_construction_is_deep_cleaning', title: 'Facts not single-sourced: denies after-construction cleanup the spoken catalogue offers (HD_b4396ad63677 B1)', kind: 'call', lang: 'en', tenant: 'synthetic_cleaner',
    turns: ['Which services do you offer?', ['Do you offer after construction cleanup?', 'Like, after construction cleanup?']], facts: {},
    xfail: { owner: 'Brain', note: 'nlu/catalogue binds services by item name only; the spoken-doc category ("after building work") and item notes are not searched, so the turn falls to "how can I help" (v2) or the model denies it (old path). Fix: one fact source (doc entries + descriptions) for bind + answer; jirani-root-cause-brain.md B1' },
    check: (r) => { const l = t(r, 1); const f = []; if (DENY.test(l)) f.push(`denied "${l}"`); if (!/deep clean/i.test(l)) f.push(`not_bound_to_deep_cleaning "${l}"`); return f; } },
  { bug: 'J-B1', id: 'JB1_sw_baada_ya_ujenzi_is_usafi_wa_kina', title: 'Facts not single-sourced (HD_b4396ad63677 B1)', kind: 'call', lang: 'sw', tenant: 'synthetic_cleaner', callLanguage: 'sw',
    turns: ['Mnafanya huduma gani?', ['Mnafanya usafi baada ya ujenzi?', 'Mnasafisha baada ya ujenzi?']], facts: {},
    xfail: { owner: 'Brain', note: 'as JB1_en: "baada ya ujenzi" is in the spoken doc category but not bound to the Deep Cleaning entry' },
    check: (r) => { const l = t(r, 1); const f = []; if (DENY.test(l)) f.push(`denied "${l}"`); if (!/usafi wa kina|deep clean/i.test(l)) f.push(`not_bound_to_deep_cleaning "${l}"`); return f; } },
  { bug: 'J-B2b', id: 'JB2b_post_check_keeps_business_name_and_clean_sentences', title: 'itemNamePostCheck deletes whole lines, incl. the business name (HD_b4396ad63677 B2b)', kind: 'probe', lang: 'en+sw',
    xfail: { owner: 'Brain', note: 'topic.itemNamePostCheck treats any Title Case "... Cleaning" run as a catalogue item (business name included) and returns line=null for the whole reply. Fix: allowlist business/agent names and the caller\'s own words; drop only the offending sentence, or replace a service claim with the grounded doc answer' },
    probe: (root) => {
      const T = require(`${root}/src/conversation/v2/topic`); const SC = require(`${root}/src/knowledge/spokenCatalogue`);
      const p = require(`${root}/evals/v2/fixtures/tenants/synthetic_cleaner.json`); const doc = SC.compileSync(p);
      const f = [];
      for (const l of ['Mtaa Bora Cleaning Services, this is Neema. How can I help?', 'Naitwa Neema wa Mtaa Bora Cleaning Services. Nikusaidie vipi?']) { const r = T.itemNamePostCheck(l, doc); if (!r.ok) f.push(`business_name_flagged ${JSON.stringify(r.offending)}`); }
      const mixed = T.itemNamePostCheck('We have Gold Star Cleaning. The team can call you back today.', doc);
      if (!mixed.line || !/team can call you back/.test(mixed.line) || /Gold Star/.test(mixed.line)) f.push(`whole_line_deleted ${JSON.stringify(mixed)}`);
      const grounded = T.itemNamePostCheck('Yes, our deep cleaning covers after-construction cleanup. Would you like to book?', doc);
      if (!grounded.ok) f.push('grounded_line_flagged');
      return f;
    } },
  { bug: 'J-B4', id: 'JB4_en_saved_contact_name_used', title: 'Saved contact name not in Brain state: asks again / says not saved (HD_b4396ad63677 B4)', kind: 'call', lang: 'en', tenant: 'synthetic_cleaner', seed: { contactName: 'Baraka' },
    turns: ['I want to book carpet cleaning on Friday at 10am in Kilimani.', 'I thought you have my name.'], facts: { name: 'Baraka' },
    xfail: { owner: 'Brain', note: 'v2 machine slot ladder checks slots.name only; state.file.contactName is never offered ("Is this Baraka?") or used, and "I thought you have my name" is not matched by the what\'s-my-name rule. Old path: contact name must be in Brain state from call start, and "not saved" may only be said from the file' },
    check: (r) => { const f = []; lines(r).forEach((l, i) => { if (NAME_ASK.test(l)) f.push(`name_asked t${i} "${l}"`); if (NOT_SAVED.test(l)) f.push(`claims_not_saved t${i}`); }); if (!lines(r).some((l) => /Baraka/.test(l))) f.push('saved_name_never_used'); return f; } },
  { bug: 'J-B4', id: 'JB4_sw_saved_contact_name_used', title: 'Saved contact name not in Brain state (HD_b4396ad63677 B4)', kind: 'call', lang: 'sw', tenant: 'synthetic_cleaner', callLanguage: 'sw', seed: { contactName: 'Baraka' },
    turns: ['Nataka kubook usafi wa carpet Ijumaa saa nne asubuhi Kilimani.', 'Nilidhani mko na jina langu.'], facts: { name: 'Baraka' },
    xfail: { owner: 'Brain', note: 'as JB4_en' },
    check: (r) => { const f = []; lines(r).forEach((l, i) => { if (NAME_ASK.test(l)) f.push(`name_asked t${i} "${l}"`); if (NOT_SAVED.test(l)) f.push(`claims_not_saved t${i}`); }); if (!lines(r).some((l) => /Baraka/.test(l))) f.push('saved_name_never_used'); return f; } },
  { bug: 'J-B5', id: 'JB5_pickup_word_is_not_a_hold', title: '"pickup" (ASR slip for cleanup) turned into a hold / reserve_for_pickup (HD_b4396ad63677 B5)', kind: 'probe', lang: 'en+sw',
    xfail: { owner: 'Brain', note: 'old-path brainState.inferIntent keyword-matches "pickup" to hold even for home_services with no product catalogue. Fix: intent comes from typed NLU with catalogue binding; hold/order kinds need a product match (v2 nlu already returns no hold here)' },
    probe: (root) => {
      const B = require(`${root}/src/conversation/brainState`); const N = require(`${root}/src/conversation/v2/nlu`);
      const p = require(`${root}/evals/v2/fixtures/tenants/synthetic_cleaner.json`);
      const f = [];
      for (const s of ['Do you offer like after construction pickup, uh, cleanup?', 'Mnafanya after construction pickup, eh, cleanup?']) {
        const u = N.understand(s, { profile: p, now: new Date('2026-10-14T05:00:00Z'), gaps: true });
        if (/order|hold|availability/.test(u.kind)) f.push(`v2_kind_${u.kind} "${s}"`);
        const i = B.inferIntent(s, { vertical: 'home_services' });
        if (/hold|order|pickup/.test(i)) f.push(`old_path_intent_${i} "${s}"`);
      }
      return f;
    } },
  { bug: 'J-B8', id: 'JB8_sw_greeting_reply_clean', title: 'Greeting-turn wording (HD_b4396ad63677 B8: "Nikuvishe au nkusaidie aje leo?")', kind: 'call', lang: 'sw', tenant: 'synthetic_cleaner', callLanguage: 'sw',
    turns: [['Habari.', 'Habari yako?']], facts: {},
    check: (r) => { const l = t(r, 0); const f = []; if (BAD_SW.test(l)) f.push(`bad_sw "${l}"`); if (!/\b(nzuri|salama|asante|karibu)\b/i.test(l) || /\b(I'm|thank you|which service)\b/i.test(l)) f.push(`not_swahili "${l}"`); return f; } },
  { bug: 'J-B8', id: 'JB8_sw_greeting_without_call_language', title: 'Greeting-turn wording (HD_b4396ad63677 B8), no STT language seed', kind: 'call', lang: 'sw', tenant: 'synthetic_cleaner',
    turns: ['Habari.'], facts: {},
    xfail: { owner: 'Brain', note: 'v2 lang stays en on a greeting-only "Habari." when no call language is seeded, so the reply is English. Fix: greeting lexicon (habari/sasa/mambo/niaje) sets sw' },
    check: (r) => { const l = t(r, 0); return BAD_SW.test(l) || /\b(I'm|thank you|which service)\b/i.test(l) ? [`not_swahili_or_bad "${l}"`] : []; } },
  { bug: 'J-B8', id: 'JB8_en_greeting_reply_clean', title: 'Greeting-turn wording (HD_b4396ad63677 B8), English', kind: 'call', lang: 'en', tenant: 'synthetic_cleaner',
    turns: [['Hello, how are you?', 'Hi, how are you doing?']], facts: {},
    check: (r) => { const l = t(r, 0); return BAD_SW.test(l) || /\b(nzuri|karibu|ungependa)\b/i.test(l) || !/\b(well|good|fine|help|service)\b/i.test(l) ? [`bad_greeting "${l}"`] : []; } },
];
module.exports.lint = lint;
module.exports.writeNeedsReadback = writeNeedsReadback;
