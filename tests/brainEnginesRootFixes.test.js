'use strict';
// BRAIN_ENGINES root-cause fixes (Alvin GO 27 Oct). Synthetic EN + SW scripts that recreate the behaviour
// of HD_231f7bef3ba4, HD_9938690bc671, HD_c51901ee8fd8 and HD_4028d2bcf47f. No prod transcripts, no Gemini.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeCall, U, PROFILE } = require('./helpers/enginesHarness');
const { speakable } = require('../src/conversation/v2/engineSpeech');
const { enforceCommitTruth, claimKind } = require('../src/conversation/v2/engineCommit');
const { assertTurnInvariants } = require('../src/conversation/v2/engineInvariants');
const { missingSlots } = require('../src/conversation/v2/enginePreconditions');
const { createState } = require('../src/conversation/v2/machine');

const CLOSED_EVENING = '2026-10-25T19:50:00+03:00'; // Sunday, closed (Sun 09:00-15:00)
const MONDAY_10AM = '2026-10-26T10:00:00+03:00';
const PAST_MIDNIGHT = '2026-10-27T00:30:00+03:00'; // Tuesday 00:30 EAT

const BRACKET = /[[\]<>{}]/;
const ISO = /\b20\d\d-\d\d-\d\d\b/;
const RAW_24H = /\b(1[3-9]|2[0-3]):[0-5]\d\b/;

function cleanLine(r, lang) {
  assert.ok(!BRACKET.test(r.line), `bracket in line: ${r.line}`);
  assert.ok(!ISO.test(r.line), `ISO date spoken: ${r.line}`);
  if (lang === 'en') assert.ok(!RAW_24H.test(r.line), `24h clock spoken in EN: ${r.line}`);
  assert.ok(!/^\s*(sawa|okay)[.!]?\s*$/i.test(r.line), `generic ack as the whole line: ${r.line}`);
  const issues = assertTurnInvariants({ line: r.line, lang: r.lang, allowReadback: true }).filter((x) => x !== 'duplicate_utterance');
  assert.deepEqual(issues.filter((x) => /mismatch|mixed/.test(x)), [], `${issues.join(',')} :: ${r.line}`);
}

// ------------------------------------------------------------------ #966 blockers
test('placeholder: no caller-facing [PROMPT-PLACEHOLDER] string in any engines module (source fix)', () => {
  const dir = path.join(__dirname, '../src/conversation/v2');
  for (const f of ['brainEngines.js', 'engineLines.js', 'engineTools.js', 'handoff.js', 'enginePlan.js', 'engineReply.js', 'engineFiller.js', 'engineCommit.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const quoted = src.match(/(['"`])[^'"`\n]*\[PROMPT-PLACEHOLDER\][^'"`\n]*\1/g) || [];
    assert.deepEqual(quoted, [], `${f} speaks a placeholder`);
  }
});

test('placeholder: last-line assertion strips any bracketed tag before TTS and reports it', () => {
  const r = speakable('[PROMPT-PLACEHOLDER] Okay. <tool>We are open {{slot}} today.', 'en');
  assert.equal(r.text, 'Okay. We are open today.');
  assert.equal(r.stripped.length, 3);
  assert.equal(speakable('Leo tuko wazi.', 'sw').stripped.length, 0);
});

test('placeholder: a model reply carrying a tag never reaches the caller; the trace records it', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  const r = await c.say({ say: 'What time do you open today?', u: U({ intent: 'ask', answers: ['hours'] }), reply: '[PROMPT-PLACEHOLDER] Today we are open from 7:30 to 18:00.' });
  assert.equal(r.line, 'Today we are open from 7:30 AM to 6 PM.');
  assert.deepEqual(c.traces[0].stripped, ['[PROMPT-PLACEHOLDER]']);
});

test('read-back mismatch: a model read-back with the wrong time is dropped; only the exact read-back is spoken', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  await c.say({ say: 'I want carpet cleaning in Kileleshwa tomorrow at 2 PM.', u: U({ intent: 'book', slots: { service: 'Carpet Cleaning', place: 'Kileleshwa', day: 'tomorrow', time: '2 PM' } }), reply: 'May I have your name?' });
  const r = await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' } , answers: ['price'] }), reply: 'Carpet cleaning is priced per square metre. Shall I book it for Tuesday at 3 PM?' });
  assert.match(r.line, /Tuesday 27 October at 2 PM in Kileleshwa, for Alvin\. Shall I book it\?/);
  assert.doesNotMatch(r.line, /3 PM/);
  assert.ok(c.traces[1].guard.some((g) => /readback_mismatch_model/.test(g.reason || '')));
  assert.equal(c.writes.length, 0);
});

test('read-back mismatch: the slots moved after the read-back -> no save on yes, one corrected read-back', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  await c.say({ say: 'Book carpet cleaning in Kileleshwa tomorrow at 2 PM, I am Alvin.', u: U({ intent: 'book', slots: { service: 'Carpet Cleaning', place: 'Kileleshwa', day: 'tomorrow', time: '2 PM', name: 'Alvin' } }) });
  const r = await c.say({ say: 'Yes, but make it Kilimani.', u: U({ intent: 'confirm', yes_no: 'yes', slots: { place: 'Kilimani' } }) });
  assert.equal(c.writes.length, 0);
  assert.equal(r.goal.type, 'readback');
  assert.match(r.line, /Kilimani/);
  const r2 = await c.say({ say: 'Yes.', u: U({ intent: 'confirm', yes_no: 'yes' }) });
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].args.landmark, 'Kilimani');
  assert.match(r2.line, /booked/);
});

test('callback time uses the injected clock: after closing it is tomorrow, never "today before 6 PM"', async () => {
  for (const [now, want] of [[CLOSED_EVENING, /tomorrow from 7:30 AM/], ['2026-10-26T19:10:00+03:00', /tomorrow from 7:30 AM/], [PAST_MIDNIGHT, /today from 7:30 AM/], [MONDAY_10AM, /today before 6 PM/]]) {
    const c = makeCall({ now });
    await c.say({ say: 'Please call me back.', u: U({ intent: 'callback' }), reply: 'May I have your name?' });
    const r = await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' } }) });
    assert.match(r.line, want, `${now}: ${r.line}`);
    cleanLine(r, 'en');
  }
});

test('read-back stays in the caller\'s turn language: a bare "Okay"/"Ndiyo" never flips EN<->SW', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  await c.say({ say: 'Naomba mwenye biashara anipigie tafadhali.', u: U({ intent: 'callback', language: 'sw' }), reply: 'Naomba jina lako, ili mwenye biashara ajue anampigia nani?' });
  const r1 = await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' }, language: 'en' }) });
  assert.equal(r1.lang, 'sw');
  assert.match(r1.line, /Nimwombe mwenye biashara/i);
  const r2 = await c.say({ say: 'Okay.', u: U({ language: 'en' }) });
  assert.equal(r2.lang, 'sw', r2.line);
  assert.doesNotMatch(r2.line, /\b(shall|please say)\b/i);
  cleanLine(r2, 'sw');
});

// ------------------------------------------------------------------ commit-before-confirm
test('commit truth: claims are dropped unless the ledger holds a committed write with a row id and receipt', () => {
  const s = [{ text: "I've asked the owner to call you back." }, { text: 'Shall I ask the owner to call you back?' }, { text: 'Your carpet cleaning is booked.' }, { text: 'We open at 7:30.' }];
  const none = enforceCommitTruth(s, []);
  assert.deepEqual(none.kept.map((x) => x.text), ['Shall I ask the owner to call you back?', 'We open at 7:30.']);
  const hollow = enforceCommitTruth(s, [{ tool: 'create_handoff', ok: true, id: null, receiptKey: 'k' }]);
  assert.equal(hollow.dropped.length, 2);
  const cb = enforceCommitTruth(s, [{ tool: 'create_handoff', ok: true, id: 'r1', receiptKey: 'k' }]);
  assert.deepEqual(cb.dropped.map((x) => x.reason), ['unbacked_claim:booking']);
  assert.equal(claimKind('Nimemwomba mwenye biashara akupigie.'), 'request');
  assert.equal(claimKind('Nimekuwekea booking yako.'), 'booking');
});

// ------------------------------------------------------------------ slot preconditions
test('slot preconditions: one table; callback needs a plausible name and a number, booking needs all five', () => {
  const m = createState({ profile: PROFILE, callerPhone: '+254700000123', callId: 'HD_x' });
  assert.deepEqual(missingSlots('create_handoff', m, { profile: PROFILE }), ['name']);
  m.slots.nameCandidate = 'Shy'; // the agent's own name is never the caller's
  assert.deepEqual(missingSlots('create_handoff', m, { profile: PROFILE }), ['name']);
  m.slots.nameCandidate = 'Alvin';
  assert.deepEqual(missingSlots('create_handoff', m, { profile: PROFILE }), []);
  assert.deepEqual(missingSlots('create_booking', m, { profile: PROFILE }), ['service', 'date', 'time', 'place']);
  const noPhone = createState({ profile: PROFILE, callerPhone: null, callId: 'HD_y' });
  noPhone.slots.nameCandidate = 'Alvin';
  assert.deepEqual(missingSlots('create_handoff', noPhone, { profile: PROFILE }), ['phone']);
});

for (const lang of ['en', 'sw']) {
  const L = (en, sw) => (lang === 'sw' ? sw : en);

  // ---------------------------------------------------------------- HD_231f7bef3ba4
  test(`HD_231f7bef3ba4 [${lang}] hours -> callback -> name asked -> read-back -> yes -> ONE write; understanding once per turn, no backup`, async () => {
    const c = makeCall({ now: CLOSED_EVENING });
    const r1 = await c.say({ say: L('when are you free, you guys? I am flexible.', 'mko wazi saa ngapi? mimi niko flexible.'), u: U({ intent: 'ask', answers: ['hours'], language: lang }), reply: L("Today we're open from 9:00 to 15:00, and we're closed now. Would you like the owner to call you back?", 'Leo tuko wazi kuanzia saa tatu asubuhi hadi saa tisa mchana, na sasa tumefunga. Ungependa mwenye biashara akupigie?') });
    cleanLine(r1, lang);
    assert.equal(r1.lang, lang);
    const r2 = await c.say({ say: L('Yes please, call me back.', 'Ndio, nipigie tafadhali.'), u: U({ intent: 'callback', yes_no: 'yes', language: lang }), reply: L('May I have your name, so the owner knows who to call?', 'Naomba jina lako, ili mwenye biashara ajue anampigia nani?') });
    assert.equal(r2.goal.type, 'ask'); assert.equal(r2.goal.slot, 'name');
    assert.match(r2.line, L(/name/i, /jina/i));
    const r3 = await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' }, language: lang }) });
    assert.equal(r3.goal.type, 'readback');
    assert.match(r3.line, L(/Alvin, shall I ask the owner to call you back on 0700 000 123, tomorrow from 7:30 AM\?/, /Alvin, nimwombe mwenye biashara akupigie simu kwa namba 0700 000 123, kesho kuanzia saa moja na nusu asubuhi\. Ni sawa\?/));
    assert.equal(c.writes.length, 0, 'no write before the yes');
    const r4 = await c.say({ say: L('Yes, okay.', 'Sawa. Wewe utamwambia nipigie?'), u: U({ intent: 'confirm', yes_no: 'yes', language: lang }) });
    assert.equal(r4.goal.type, 'commit');
    assert.equal(c.writes.length, 1);
    assert.equal(c.writes[0].kind, 'create_service_request');
    assert.equal(c.writes[0].args.name, 'Alvin');
    assert.match(r4.line, L(/^Done, I've asked the owner to call you on 0700 000 123, tomorrow from 7:30 AM\./, /^Tayari, nimemwomba mwenye biashara akupigie/));
    for (const r of [r1, r2, r3, r4]) cleanLine(r, lang);
    assert.equal(c.calls.understand, 4, 'one understanding call per turn');
    assert.ok(c.calls.models.every((m) => m === c.calls.models[0]), 'no backup model race');
    assert.deepEqual(c.receipts.map((x) => x.phase), ['proposed', 'confirmed', 'committed']);
    assert.ok(c.receipts.every((x) => x.callId === '11111111-2222-4333-8444-555555555555' && x.callSid === 'HD_synthetic0001'), 'receipts carry calls.id and call_sid');
  });

  test(`HD_231f7bef3ba4 [${lang}] date never asked 4 times: two misses on the same slot offer the owner instead`, async () => {
    const c = makeCall({ now: MONDAY_10AM });
    const say = (t) => c.say({ say: t, u: U({ intent: 'book', slots: { service: 'Carpet Cleaning' }, language: lang }), reply: L('Which day would you like?', 'Siku gani ingekufaa?') });
    const a = await say(L('I need carpet cleaning.', 'Nataka usafi wa zulia.'));
    const b = await say(L('I am flexible.', 'Mimi niko flexible tu.'));
    const d = await say(L('Any day really.', 'Siku yoyote tu.'));
    assert.equal(a.goal.slot, 'date'); assert.equal(b.goal.slot, 'date');
    assert.equal(d.goal.slot, 'name'); assert.equal(d.goal.why, 'callback');
    const dateAsks = c.traces.filter((t) => t.goal && t.goal.type === 'ask' && t.goal.slot === 'date').length;
    assert.equal(dateAsks, 2);
  });

  // ---------------------------------------------------------------- HD_9938690bc671
  test(`HD_9938690bc671 [${lang}] wants the boss: name refused then given, no claim before the save, one language per turn`, async () => {
    const c = makeCall({ now: MONDAY_10AM });
    const r1 = await c.say({ say: L('I wanted to talk with the owner.', 'Ah, ilikuwa nataka kuongea na boss.'), u: U({ intent: 'handoff', wants_human: true, language: lang }), reply: L("The owner isn't on the line now. May I have your name?", 'Mwenye biashara hayupo kwa sasa. Naomba jina lako?') });
    assert.equal(r1.goal.slot, 'name');
    const r2 = await c.say({ say: L('Uh, no.', 'Eeh, hapana.'), u: U({ yes_no: 'no', language: lang }), reply: L("I have asked the manager to call you back. May I have your name so the owner knows who to call?", 'Nimemwomba meneja akupigie. Naomba jina lako ili ajue anampigia nani?') });
    assert.doesNotMatch(r2.line, /asked the manager|Nimemwomba meneja/i, 'unbacked claim dropped');
    assert.match(r2.line, L(/name/i, /jina/i));
    const r3 = await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' }, language: lang }) });
    assert.equal(r3.goal.type, 'readback');
    assert.equal(c.writes.length, 0);
    const r4 = await c.say({ say: L('Yes.', 'Ndiyo.'), u: U({ yes_no: 'yes', language: lang }) });
    assert.equal(c.writes.length, 1);
    for (const r of [r1, r2, r3, r4]) { assert.equal(r.lang, lang); cleanLine(r, lang); }
  });

  test(`HD_9938690bc671 [${lang}] a caller who never gives a name: no write is attempted, one honest line`, async () => {
    const c = makeCall({ now: MONDAY_10AM });
    await c.say({ say: L('I want to speak to the owner.', 'Nataka kuongea na mwenye biashara.'), u: U({ wants_human: true, language: lang }), reply: L('May I have your name?', 'Naomba jina lako?') });
    await c.say({ say: L('Uh, no.', 'Eeh, hapana.'), u: U({ yes_no: 'no', language: lang }), reply: L('I need a name so the owner knows who to call. May I have it?', 'Nahitaji jina ili mwenye biashara ajue anampigia nani. Naomba jina lako?') });
    const r = await c.say({ say: L('No, I said no.', 'Hapana, nimesema hapana.'), u: U({ yes_no: 'no', language: lang }), reply: null });
    assert.equal(r.goal.type, 'no_name');
    assert.equal(c.writes.length, 0);
    assert.match(r.line, L(/Without a name/, /Bila jina/));
  });

  // ---------------------------------------------------------------- HD_c51901ee8fd8
  test(`HD_c51901ee8fd8 [${lang}] callback save fails after the yes: ONE owner request row, honest line, alert only after the row`, async () => {
    const order = [];
    const c = makeCall({
      now: MONDAY_10AM,
      write: (payload, n) => {
        order.push(`write${n}`);
        if (n === 1) return { results: [{ action: 'create_service_request', status: 'invalid', reason: 'A callback needs the caller name.' }] };
        return { results: [{ action: 'create_service_request', status: 'succeeded', id: 'owner-req-1' }] };
      },
      dispatch: async () => { order.push('alert'); return [{ channel: 'sms' }]; },
    });
    await c.say({ say: L('Please call me back.', 'Tafadhali nipigie.'), u: U({ intent: 'callback', language: lang }), reply: L('May I have your name?', 'Naomba jina lako?') });
    await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' }, language: lang }) });
    const r = await c.say({ say: L('Yes.', 'Ndiyo.'), u: U({ yes_no: 'yes', language: lang }) });
    assert.equal(r.write.status, 'failed_fallback_saved');
    assert.match(r.line, L(/^Sorry, the callback didn't save\. I've left the owner a note to call you on 0700 000 123\.$/, /^Samahani, ombi la kupigiwa simu haikuhifadhiwa\. Nimemwachia mwenye biashara ujumbe/));
    assert.doesNotMatch(r.line, /couldn't save that\. I've asked the owner/);
    assert.deepEqual(order, ['write1', 'write2', 'alert'], 'alert only after the owner request row exists');
    assert.equal(c.writes.length, 2);
    assert.match(c.writes[1].args.notes, /Not saved on the call/);
    assert.deepEqual(c.receipts.map((x) => x.phase), ['proposed', 'confirmed', 'failed', 'committed']);
    // later in the call: "is it in your notes?" — a model claim is backed by the owner request row only
    const r2 = await c.say({ say: L('Is my callback in your notes?', 'Je, ombi langu liko kwenye rekodi?'), u: U({ intent: 'ask', answers: ['booking_status'], language: lang }), reply: L("Yes, I've left the owner a note to call you back.", 'Ndio, nimemwachia mwenye biashara ujumbe akupigie.') });
    assert.match(r2.line, L(/left the owner a note/, /nimemwachia/i));
    assert.equal(c.writes.length, 2, 'no second owner request');
  });

  test(`HD_c51901ee8fd8 [${lang}] both saves fail: nothing claimed, no alert sent, never "I've asked the owner"`, async () => {
    const c = makeCall({
      now: MONDAY_10AM,
      write: () => ({ results: [{ action: 'create_service_request', status: 'failed', reason: 'db down' }] }),
      dispatch: async () => [{ channel: 'sms' }],
    });
    await c.say({ say: L('Please call me back.', 'Tafadhali nipigie.'), u: U({ intent: 'callback', language: lang }), reply: L('May I have your name?', 'Naomba jina lako?') });
    await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' }, language: lang }) });
    const r = await c.say({ say: L('Yes.', 'Ndiyo.'), u: U({ yes_no: 'yes', language: lang }) });
    assert.equal(r.write.status, 'failed_nothing_saved');
    assert.equal(c.notifies.length, 0, 'no owner alert without a saved row');
    assert.doesNotMatch(r.line, /asked the owner|Nimemwomba|left the owner/i);
    assert.match(r.line, L(/Please call us again/, /piga simu tena/));
    const r2 = await c.say({ say: L('So will the owner call me?', 'Kwa hivyo mwenye biashara atanipigia?'), u: U({ intent: 'ask', language: lang }), reply: L('Yes, the owner will call you back.', 'Ndio, mwenye biashara atakupigia.') });
    assert.doesNotMatch(r2.line, /will call you back|atakupigia/i, 'unbacked promise dropped');
  });

  // ---------------------------------------------------------------- HD_4028d2bcf47f
  test(`HD_4028d2bcf47f [${lang}] booking: no "booked" before the write, spoken date not ISO, booked only with a row id`, async () => {
    const c = makeCall({ now: MONDAY_10AM });
    const r1 = await c.say({ say: L('I want to make a booking for Kileleshwa, for Carpet Cleaning.', 'Nataka kubook usafi wa carpet Kileleshwa.'), u: U({ intent: 'book', slots: { service: 'Carpet Cleaning', place: 'Kileleshwa' }, language: lang }), reply: L('Which day would you like?', 'Siku gani ingekufaa?') });
    assert.equal(r1.goal.slot, 'date');
    const r2 = await c.say({ say: L('2 PM tomorrow.', 'Kesho saa nane mchana.'), u: U({ slots: { day: 'tomorrow', time: '14:00' }, language: lang }), reply: L('I have your Carpet Cleaning booking for Kileleshwa on 2026-10-27 at 2 PM. May I have your name?', 'Nimekuwekea booking ya Carpet Cleaning Kileleshwa 2026-10-27. Naomba jina lako?') });
    assert.doesNotMatch(r2.line, /I have your Carpet Cleaning booking|Nimekuwekea/, 'unbacked booking claim dropped');
    assert.match(r2.line, L(/name/i, /jina/i));
    const r3 = await c.say({ say: L('Alvin is the name.', 'Alvin ndio jina langu.'), u: U({ slots: { name: 'Alvin' }, language: lang }) });
    assert.equal(r3.goal.type, 'readback');
    assert.match(r3.line, L(/Carpet Cleaning on Tuesday 27 October at 2 PM in Kileleshwa, for Alvin\. Shall I book it\?/, /Jumanne 27 Oktoba saa nane mchana, Kileleshwa, kwa Alvin\. Nithibitishe\?/));
    assert.equal(c.writes.length, 0);
    const r4 = await c.say({ say: L('Yes.', 'Ndiyo.'), u: U({ yes_no: 'yes', language: lang }) });
    assert.equal(c.writes.length, 1);
    assert.equal(c.writes[0].kind, 'create_appointment');
    assert.match(r4.line, L(/^Done, your carpet cleaning is booked for Tuesday 27 October at 2 PM in Kileleshwa\./, /^Imekamilika, nimekuwekea/));
    for (const r of [r1, r2, r3, r4]) cleanLine(r, lang);
  });

  test(`HD_4028d2bcf47f [${lang}] the write returns ok without a row id: never "booked"; one owner request, honest line`, async () => {
    const c = makeCall({
      now: MONDAY_10AM,
      write: (payload, n, kind) => (kind === 'create_appointment'
        ? { results: [{ action: 'create_appointment', status: 'succeeded' }] }
        : { results: [{ action: 'create_service_request', status: 'succeeded', id: 'owner-req-9' }] }),
    });
    await c.say({ say: L('Book carpet cleaning in Kileleshwa tomorrow at 2 PM. I am Alvin.', 'Nibookie usafi wa carpet Kileleshwa kesho saa nane mchana. Mimi ni Alvin.'), u: U({ intent: 'book', slots: { service: 'Carpet Cleaning', place: 'Kileleshwa', day: 'tomorrow', time: '14:00', name: 'Alvin' }, language: lang }) });
    const r = await c.say({ say: L('Yes.', 'Ndiyo.'), u: U({ yes_no: 'yes', language: lang }) });
    assert.equal(r.write.status, 'failed_fallback_saved');
    assert.doesNotMatch(r.line, /booked|nimekuwekea/i);
    assert.match(r.line, L(/the booking didn't save/, /booking haikuhifadhiwa/));
    assert.equal(c.writes.filter((w) => w.kind === 'create_service_request').length, 1);
  });

  // ---------------------------------------------------------------- read-back answer rules
  test(`read-back answers [${lang}]: exact repeated time = yes, different time = change, unclear = one yes/no re-ask`, async () => {
    const book = U({ intent: 'book', slots: { service: 'Carpet Cleaning', place: 'Kileleshwa', day: 'tomorrow', time: '14:00', name: 'Alvin' }, language: lang });
    const same = makeCall({ now: MONDAY_10AM });
    await same.say({ say: L('Book carpet cleaning in Kileleshwa tomorrow at 2 PM. I am Alvin.', 'Nibookie usafi wa carpet Kileleshwa kesho saa nane mchana. Mimi ni Alvin.'), u: book });
    const ry = await same.say({ say: L('Tomorrow at 2 PM.', 'Kesho saa nane mchana.'), u: U({ language: lang }) });
    assert.equal(ry.goal.type, 'commit'); assert.equal(same.writes.length, 1);

    const diff = makeCall({ now: MONDAY_10AM });
    await diff.say({ say: L('Book carpet cleaning in Kileleshwa tomorrow at 2 PM. I am Alvin.', 'Nibookie usafi wa carpet Kileleshwa kesho saa nane mchana. Mimi ni Alvin.'), u: book });
    const rc = await diff.say({ say: L('Make it 3 PM.', 'Saa tisa mchana.'), u: U({ slots: { time: '15:00' }, language: lang }) });
    assert.equal(rc.goal.type, 'readback'); assert.equal(diff.writes.length, 0);
    assert.match(rc.line, L(/3 PM/, /saa tisa/));

    const unc = makeCall({ now: MONDAY_10AM });
    await unc.say({ say: L('Book carpet cleaning in Kileleshwa tomorrow at 2 PM. I am Alvin.', 'Nibookie usafi wa carpet Kileleshwa kesho saa nane mchana. Mimi ni Alvin.'), u: book });
    const r1 = await unc.say({ say: L('Hmm, what about the price?', 'Mmh, na bei je?'), u: U({ language: lang }) });
    assert.equal(r1.goal.type, 'reask');
    assert.match(r1.line, L(/Please say yes or no/, /sema ndio au hapana/));
    const r2 = await unc.say({ say: L('I am not sure.', 'Sijui.'), u: U({ language: lang }), reply: L('What would you like to change?', 'Ungependa kubadilisha nini?') });
    assert.equal(r2.goal.type, 'ask'); assert.equal(r2.goal.slot, 'change');
    assert.equal(unc.writes.length, 0);
  });
}

// ------------------------------------------------------------------ understanding first + latency budget
test('understanding first: hard cap holds, rules fallback answers, one meaningful filler (never "Sawa")', async () => {
  const fillers = [];
  const c = makeCall({ now: MONDAY_10AM, understandDelayMs: 5000, env: { BRAIN_ENGINES_UNDERSTAND_MS: '150', BRAIN_ENGINES_FILLER_MS: '40' } });
  const t0 = Date.now();
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'Today we are open from 7:30 to 18:00.' });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `turn took ${ms} ms`);
  const f = r.streamed.filter((s) => s.filler);
  assert.equal(f.length, 1);
  assert.equal(f[0].text, 'Checking our hours.');
  assert.doesNotMatch(f[0].text, /^(sawa|okay)/i);
  assert.equal(c.traces[0].understanding.source, 'fallback');
  assert.equal(c.traces[0].understanding.fallbackReason, 'timeout');
  assert.ok(c.traces[0].timings.understandMs >= 140 && c.traces[0].timings.understandMs < 600, JSON.stringify(c.traces[0].timings));
  assert.match(r.line, /7:30 AM/);
  fillers.push(...f);
});

test('no filler when understanding returns before the threshold; each sentence streamed exactly once', async () => {
  const c = makeCall({ now: MONDAY_10AM, env: { BRAIN_ENGINES_FILLER_MS: '400' } });
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'Today we are open from 7:30 to 18:00. Anything else?' });
  assert.equal(r.streamed.filter((s) => s.filler).length, 0);
  assert.equal(r.streamed.map((s) => s.text).join(' '), r.line);
  assert.equal(r.streamed_ok, undefined);
  assert.equal(r.streamed.length, 2);
});

// ------------------------------------------------------------------ per-turn trace
test('per-turn trace: one record per turn via onModelStage with goal, tool hash, write result and timings', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  await c.say({ say: 'Please call me back.', u: U({ intent: 'callback' }), reply: 'May I have your name?' });
  await c.say({ say: 'Alvin.', u: U({ slots: { name: 'Alvin' } }) });
  await c.say({ say: 'Yes.', u: U({ yes_no: 'yes' }) });
  assert.equal(c.traces.length, 3);
  assert.ok(c.traces.every((t) => t.kind === 'brain_engines' && Number.isFinite(t.timings.understandMs) && Number.isFinite(t.timings.firstWordMs)));
  assert.deepEqual(c.traces.map((t) => t.goal.type), ['ask', 'readback', 'commit']);
  assert.equal(c.traces[2].write.status, 'committed');
  assert.ok(c.traces[2].tool.slotsHash && c.traces[2].tool.idempotencyKey);
  assert.deepEqual(c.traces.map((t) => t.turnIndex), [0, 1, 2]);
  assert.equal(c.traces[1].understanding.slots.name, 'given', 'no caller name in the trace');
});

test('trace sink that throws never breaks the turn', async () => {
  const c = makeCall({ now: MONDAY_10AM, onModelStage: () => { throw new Error('sink down'); } });
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'Today we are open from 7:30 to 18:00.' });
  assert.match(r.line, /7:30 AM/);
});

// ------------------------------------------------------------------ response engine
test('response engine: hours answer is model-written from receipts; an invented time is dropped (receipt fact instead)', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  const r = await c.say({ say: 'What time do you close today?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We close at 8 PM today.' });
  assert.doesNotMatch(r.line, /8 PM/);
  assert.match(r.line, /6 PM/);
  assert.ok(c.traces[0].guard.some((g) => /time_not_in_receipts/.test(g.reason || '')));
  const c2 = makeCall({ now: MONDAY_10AM });
  const r2 = await c2.say({ say: 'What time do you close today?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We close at 6 PM today, so there is still time.' });
  assert.equal(r2.answeredBy, 'model');
  assert.equal(r2.line, 'We close at 6 PM today, so there is still time.');
});

test('response engine: slot question is the model\'s own wording; a reply with no question gets the plain ask appended', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  const r = await c.say({ say: 'I want carpet cleaning.', u: U({ intent: 'book', slots: { service: 'Carpet Cleaning' } }), reply: 'Great choice. Which day suits you best?' });
  assert.equal(r.line, 'Great choice. Which day suits you best?');
  const c2 = makeCall({ now: MONDAY_10AM });
  const r2 = await c2.say({ say: 'I want carpet cleaning.', u: U({ intent: 'book', slots: { service: 'Carpet Cleaning' } }), reply: 'Great choice.' });
  assert.match(r2.line, /^Great choice\. What day would you like\?$/);
});

test('flag off: liveTurn never enters the engines path', async () => {
  const c = makeCall({ now: MONDAY_10AM, env: { BRAIN_ENGINES: 'off' } });
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'Today we are open from 7:30 to 18:00.' });
  assert.notEqual(r.path, 'brain_engines');
  assert.equal(c.traces.some((t) => t.kind === 'brain_engines'), false);
});

test('no model: a follow-up price question never repeats the same fact line; the honest unknown offers a callback, and the offer expires', async () => {
  const c = makeCall({ now: MONDAY_10AM });
  const r1 = await c.say({ say: 'Do you come to Rongai?', u: U({ intent: 'ask', answers: ['coverage'], slots: { place: 'Rongai' } }), reply: '' });
  const r2 = await c.say({ say: 'And the fee?', u: U({ intent: 'ask', answers: ['price'] }), reply: '' });
  assert.notEqual(r2.line, r1.line);
  assert.match(r2.line, /don't have a price/i);
  assert.equal(c.live.getState().eng.offered, 'callback');
  await c.say({ say: 'Hmm let me think about the carpets.', u: U({ intent: 'ask' }), reply: 'Sure, take your time.' });
  await c.say({ say: 'Another thing.', u: U({ intent: 'ask' }), reply: 'Of course, go ahead.' });
  assert.equal(c.live.getState().eng.offered, null, 'a stale offer is dropped');
  const r5 = await c.say({ say: 'Yes.', u: U({ intent: 'ack', yes_no: 'yes' }), reply: 'Great, how can I help?' });
  assert.equal(c.writes.length, 0, 'a later unrelated yes never books a callback');
  assert.notEqual(r5.path, 'brain_engines_commit');
});

test('no dead air: the one filler also covers a slow reply (fast understanding), and never comes after the real line', async () => {
  const c = makeCall({ now: MONDAY_10AM, understandDelayMs: 0, replyDelayMs: 1000 });
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' });
  assert.equal(r.streamed[0].filler, true);
  assert.match(r.streamed[0].text, /hours/);
  assert.equal(r.streamed.filter((s) => s.filler).length, 1);
  const c2 = makeCall({ now: MONDAY_10AM });
  const r2 = await c2.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' });
  await new Promise((res) => setTimeout(res, 800));
  assert.equal(r2.streamed.some((s) => s.filler), false, 'fast turn: no filler, and none fires late');
});

// ------------------------------------------------------------------ filler contract (Voice #976 stands down on it)
const { LINES: FILLER_LINES, fillerDelayMs, FILLER_MAX_MS } = require('../src/conversation/v2/engineFiller');

test('filler contract: sent once per turn as {text, lang, filler:true, uncuttable:true}, before the real line, even on a very slow turn', async () => {
  const c = makeCall({ now: MONDAY_10AM, understandDelayMs: 300, replyDelayMs: 300, env: { BRAIN_ENGINES_UNDERSTAND_MS: '1500', BRAIN_ENGINES_FILLER_MS: '40' } });
  for (const step of [
    { say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' },
    { say: 'Na mnafika Rongai kweli?', u: U({ intent: 'ask', lang: 'sw', answers: ['coverage'], slots: { place: 'Rongai' } }), reply: 'Ndio, tunafika Ongata Rongai.' },
  ]) {
    const r = await c.say(step);
    const f = r.streamed.filter((s) => s.filler);
    assert.equal(f.length, 1, 'exactly one filler this turn');
    assert.deepEqual(Object.keys(f[0]).sort(), ['filler', 'lang', 'text', 'uncuttable']);
    assert.equal(f[0].filler, true);
    assert.equal(f[0].uncuttable, true);
    assert.ok(['en', 'sw'].includes(f[0].lang));
    assert.equal(r.streamed[0], f[0], 'the filler comes first');
    assert.ok(r.streamed.slice(1).every((s) => !s.filler && !s.uncuttable), 'real lines are not marked as filler');
  }
});

test('filler lines are short (about three words, under ~1 s spoken) and never a bare ack', () => {
  for (const [k, v] of Object.entries(FILLER_LINES)) {
    for (const lang of ['en', 'sw']) {
      const t = v[lang];
      assert.ok(t.split(/\s+/).length <= 3, `${k}/${lang} too many words: ${t}`);
      assert.ok(t.length <= 22, `${k}/${lang} too long to say in ~1 s: ${t}`);
      assert.doesNotMatch(t, /^(sawa|okay|ok|sure)[.!]?$/i);
    }
  }
});

test('BRAIN_ENGINES_FILLER_MS defaults to 700 and is clamped to 850 so it always beats Voice\'s 900 ms filler', async () => {
  assert.equal(FILLER_MAX_MS, 850);
  assert.equal(fillerDelayMs({}), 700);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '' }), 700);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: 'abc' }), 700);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '600' }), 600);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '850' }), 850);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '900' }), 850);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '5000' }), 850);
  assert.equal(fillerDelayMs({ BRAIN_ENGINES_FILLER_MS: '0' }), 0);
  // end to end: a misconfigured 5000 ms still fires at the clamp, before 900 ms
  const c = makeCall({ now: MONDAY_10AM, understandDelayMs: 1200, env: { BRAIN_ENGINES_FILLER_MS: '5000' } });
  const r = await c.say({ say: 'What time do you open today please?', u: U({ intent: 'ask', answers: ['hours'] }), reply: 'We open at 7:30 AM today.' });
  assert.equal(r.streamed[0].filler, true);
  // armed at the 850 clamp (not 5000): fired after 850 and before the 1200 ms understanding returned
  assert.ok(c.traces[0].filler.atMs >= 849 && c.traces[0].filler.atMs < 1200, `filler at ${c.traces[0].filler.atMs} ms`);
});
