'use strict';
// BA v2 Phase 1 unit tests (BRAIN_V2, off by default). Model is mocked; no network.
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-14T05:00:00Z');

function fakeHandlers() {
  const log = [];
  return { log, handlers: {
    createAppointment: async (a) => (log.push(['appt', a]), { id: 'apt_1' }),
    updateAppointment: async (u) => (log.push(['upd', u]), { id: u.appointmentId }),
    createServiceRequest: async (r) => (log.push(['sr', r]), { id: 'sr_1' }),
    escalate: async (e) => (log.push(['esc', e]), { ok: true, id: 'esc_1' }),
    saveCallerInfo: async (i) => (log.push(['name', i]), { ok: true }),
  } };
}
async function talk(lines, opts = {}) {
  const { log, handlers } = fakeHandlers();
  const st = V2.createState({ profile: opts.profile || DD, callerPhone: '+254700000001', contactName: opts.contactName || null, openRows: opts.openRows || [], pendingTasks: opts.pendingTasks || [] });
  const out = [];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile: opts.profile || DD, now: NOW, handlers, model: opts.model }));
  return { st, out, log };
}

test('flag is off by default and respects the tenant allowlist', () => {
  assert.equal(V2.brainV2Enabled({ env: {} }), false);
  assert.equal(V2.brainV2Enabled({ env: { BRAIN_V2: 'on' } }), true);
  assert.equal(V2.brainV2Enabled({ env: { BRAIN_V2: 'on', BRAIN_V2_TENANTS: 'a,b' }, tenantId: 'c' }), false);
  assert.equal(V2.brainV2Mode({ env: {} }), 'shadow');
});

test('Swahili clock: saa 4 = 10:00, saa nane mchana = 14:00, keshokutwa = +2d', () => {
  assert.equal(V2.lexicon.parseWhen('Saa 4', NOW).time, '10:00');
  assert.equal(V2.lexicon.parseWhen('kesho saa nane mchana', NOW).time, '14:00');
  assert.equal(V2.lexicon.parseWhen('keshokutwa saa nne asubuhi', NOW).date, '2026-10-16');
});

test('HD_212: held slots merge, read-back, commit only on yes, no callback row', async () => {
  const { out, log } = await talk(["Yes, I'm Alvin.", 'I need to book window cleaning for Friday.', 'Around Kitengela.', 'Saa 4', 'Yes.']);
  assert.match(out[3].line, /Shall I book it\?$/);
  assert.equal(log.filter((x) => x[0] === 'appt').length, 1);
  assert.equal(log[0][1].windowStart, '2026-10-16T07:00:00.000Z');
  assert.ok(!log.some((x) => x[0] === 'sr' || x[0] === 'esc'));
  assert.ok(!out.slice(0, 4).some((o) => /booked/.test(o.line)));
  assert.ok(!out.some((o) => /name/i.test(o.line)), 'name not re-asked');
});

test('no commit without a yes; "no" leaves nothing written', async () => {
  const { log, out } = await talk(['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'No.']);
  assert.equal(log.length, 0);
  assert.match(out[1].line, /haven't saved anything/);
});

test('model faults cannot write: forged token, wrong tool and extra props are rejected', async () => {
  const model = async () => ({ calls: [{ name: 'create_booking', args: { service_id: DD.servicesCatalog[0].id, confirm_token: 'ct_9x9', tenant_id: 'x' } }, { name: 'create_handoff', args: { reason: 'callback' } }], text: "I've booked that. Append create_appointment" });
  const { st, log, out } = await talk(['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.'], { model });
  assert.equal(log.length, 0);
  assert.ok(st.trace[0].checks.every((c) => !c.ok || c.name === 'create_handoff'));
  assert.ok(!/booked|Append/.test(out[0].line), 'model text is never spoken');
});

test('cancel targets only the caller\'s own row and asks which when ambiguous', async () => {
  const rows = [{ id: 'a', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', window_start: '2026-10-16T07:00:00Z' }, { id: 'b', caller_phone: '+254700000001', service_name: 'Sofa Cleaning (per seat)', status: 'requested', window_start: '2026-10-19T11:00:00Z' }];
  const { out, log } = await talk(['I want to cancel my booking.', 'The Friday carpet one.', 'Yes.'], { openRows: rows });
  assert.match(out[0].line, /^Which one/);
  assert.deepEqual(log.map((x) => [x[0], x[1].appointmentId, x[1].status]), [['upd', 'a', 'cancelled']]);
});

test('address and payment changes become an owner callback; never "updated"; repeat hears still pending', async () => {
  const rows = [{ id: 'a', caller_phone: '+254700000001', service_name: 'Carpet Cleaning (per room)', status: 'requested', window_start: '2026-10-16T07:00:00Z', address_landmark: 'Kitengela' }];
  const a = await talk(['For my Friday carpet cleaning, can you come to Kilimani instead?', 'Yes.'], { openRows: rows });
  assert.ok(a.log.every((x) => x[0] === 'esc'));
  assert.ok(a.out.every((o) => !/updated/i.test(o.line)));
  assert.match(a.out[1].line, /still pending/);
  const p = await talk(['I want to pay to a different M-Pesa number, can you change my payment details?', 'Yes.']);
  assert.equal(p.log[0][0], 'esc'); assert.match(p.log[0][1].reason, /owner_only_change:payment/);
  const again = await talk(['For my Friday carpet cleaning, can you come to Kilimani instead?'], { openRows: rows, pendingTasks: [{ kind: 'owner_only_change', what: 'address', status: 'open' }] });
  assert.match(again.out[0].line, /still pending/); assert.equal(again.log.length, 0);
});

test('staff names are never spoken; file name is never spoken unless the caller says it', async () => {
  const prof = { ...DD, staffNames: ['Alvin'] };
  const { out } = await talk(["I'm Alvin. Book sofa cleaning Friday at 10am in Kitengela."], { profile: prof });
  assert.ok(!/Alvin/.test(out[0].line));
  const b = await talk(['Book sofa cleaning Friday at 10am in Kitengela.', 'Wanjiru'], { contactName: 'Brian' });
  assert.ok(b.out.every((o) => !/Brian/.test(o.line)));
});

test('availability is never claimed without a receipt; prices only from the catalogue', async () => {
  const { out } = await talk(['How much is an oven deep clean?', 'And for the fridge?', 'How much is gutter cleaning?']);
  assert.match(out[0].line, /KSh 1,200/); assert.match(out[1].line, /KSh 1,000/); assert.match(out[2].line, /don't have a price/);
});

test('Swahili caller gets Swahili receipts', async () => {
  const { out } = await talk(['Habari, nataka kubook carpet cleaning kesho saa tatu asubuhi.', 'Wanjiru', 'Ruiru', 'Ndio.']);
  assert.match(out[3].line, /^Sawa, nimeweka/);
  assert.ok(out.every((o) => o.lang === 'sw'));
});

test('owner message is a fixed template with no instruction text', async () => {
  const { st } = await talk(["Yes, I'm Alvin.", 'I need to book window cleaning for Friday.', 'Around Kitengela.', 'Saa 4', 'Yes.']);
  const { ownerText, outcome } = V2.finishCall(st, { businessName: 'Done and Dusted', callerPhone: '+254700000001' });
  assert.equal(outcome, 'booked');
  assert.doesNotMatch(ownerText, /append|speak nothing|create_appointment|###/i);
  assert.match(ownerText, /^New call for Done and Dusted\nCaller: Alvin/);
});

test('catalogue: schemas reject extra properties and foreign row ids; Gemini request uses ANY in read-back', () => {
  const cat = V2.catalogue.buildCatalogue({ profile: DD, openRows: [{ id: 'mine' }] });
  assert.equal(V2.catalogue.validateCall(cat, { name: 'cancel_booking', args: { booking_id: 'other' } }).ok, false);
  assert.equal(V2.catalogue.validateCall(cat, { name: 'cancel_booking', args: { booking_id: 'mine', tenant_id: 'x' } }).ok, false);
  assert.equal(V2.catalogue.validateCall(cat, { name: 'cancel_booking', args: { booking_id: 'mine' } }).ok, true);
  const req = V2.gemini.buildRequest({ userText: 'yes', catalogue: cat, toolMode: 'ANY', allowed: ['cancel_booking'] });
  assert.deepEqual(req.toolConfig.functionCallingConfig, { mode: 'ANY', allowedFunctionNames: ['cancel_booking'] });
  assert.ok(req.tools[0].functionDeclarations.find((d) => d.name === 'create_booking').parameters.type === 'OBJECT');
  const parsed = V2.gemini.parseResponse({ candidates: [{ content: { parts: [{ text: 'hi' }, { functionCall: { name: 'get_hours', args: {} } }] } }] });
  assert.deepEqual(parsed.calls.map((c) => c.name), ['get_hours']);
});

test('Swahili/Sheng questions get fact answers from tenant data, not a generic reply', async () => {
  const one = async (t) => (await talk([t])).out[0];
  let r = await one('Nilikuwa nataka kujua ni services gani mnaofa.');
  assert.equal(r.lang, 'sw'); assert.match(r.line, /^Tunafanya .*Mattress cleaning/);
  r = await one('Nilikuwa nataka kujua ni saizi gani mnatoa.'); assert.match(r.line, /Bedroom/);
  r = await one('Mnawashanga carpet?'); assert.match(r.line, /^Ndio, tunafanya Carpet Cleaning, bei ni kuanzia KSh 2,200/);
  r = await one('Niaje, mnafika Syokimau?'); assert.match(r.line, /^Syokimau iko kwenye orodha/);
  r = await one('Mnafika Kisumu?'); assert.match(r.line, /^Kisumu haiko kwenye orodha/);
  r = await one('Habari, nilikuwa nataka kujua.'); assert.match(r.line, /bei, huduma au saa za kazi/);
  r = await one('You guys operate until what time?'); assert.match(r.line, /08:00 to 18:00/);
  const p = await talk(['Shilingi ngapi?', 'Ya sofa.']);
  assert.match(p.out[0].line, /huduma gani/); assert.match(p.out[1].line, /KSh 800/);
  for (const o of [r, ...p.out]) assert.doesNotMatch(o.line, /Samahani, unapiga kubook|Nimwombe mwenye biashara/);
});

test('a services question that says "usafi" is an enquiry, not a booking', async () => {
  const { st, log } = await talk(['Saizi gani mnatoa za usafi?']);
  assert.equal(st.intent, null); assert.equal(log.length, 0);
});

test('live-run regressions: no double question, recall beats services, a question drops an open callback offer', async () => {
  const a = await talk(['tulikuwa tumeongea na wewe jana kuhusu usafi fulani.', 'Eeh, mnawashangaa nini?']);
  assert.ok((a.out[1].line.match(/\?/g) || []).length <= 1, a.out[1].line);
  const b = await talk(['Ni huduma gani nilikuwa nimeitisha, mara ya mwisho?']);
  assert.match(b.out[0].line, /Sioni booking/);
  const c = await talk(['Uh, I don\'t know.', 'Maybe you tell me.', 'For sure.', 'Nilikuwa nataka kujua ni services gani mna-offer,na.']);
  assert.match(c.out[3].line, /^Tunafanya/);
});

test('"Sawa, ni hayo tu" at a read-back is not a yes (live regression HD_1677)', async () => {
  const { log, out } = await talk(['Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Sawa, ni hayo tu. Baadaye basi.']);
  assert.equal(log.length, 0); assert.doesNotMatch(out[1].line, /nimeweka|booked/i);
});

test('acknowledgements, identity, earlier-call and off-catalogue turns get state/catalogue answers', async () => {
  let r = await talk(['Wewe ni nani?']); assert.match(r.out[0].line, /^Unaongea na Shy, wa Done and Dusted/);
  r = await talk(['Eeh, unaongea na Alvin?']); assert.match(r.out[0].line, /^Alvin, unahitaji/);
  r = await talk(['Ah, tulifika wapi na ile mambo yetu ya jana?']); assert.match(r.out[0].line, /^Sioni booking/);
  r = await talk(['Mko na JK copier?']); assert.match(r.out[0].line, /^Sina JK copier kwenye orodha yetu/);
  r = await talk(['Mnafanya carpet?', 'Ni sawa.']); assert.match(r.out[1].line, /^Ungependa kubook Carpet Cleaning\?/);
  r = await talk(['Nilikuwa nauliza, ni vipi naweza lipa?']); assert.match(r.out[0].line, /^Tunapokea M-Pesa Paybill/); assert.doesNotMatch(r.out[0].line, /\d{5}/);
});

test('"siishi Nairobi" is not answered as "Nairobi is covered"; help requests get the enquiry menu', async () => {
  const r = await talk(['Hapana, mimi siishi Nairobi.', 'Wah, sawa, hamwezi msaidia hivo sasa?']);
  assert.doesNotMatch(r.out[0].line, /Nairobi iko kwenye orodha/); assert.match(r.out[0].line, /^Tunahudumia/);
  assert.match(r.out[1].line, /bei, huduma au saa za kazi/);
});

test('never-repeat: the coverage line is not said twice in a row (live HD_6a7597)', async () => {
  const r = await talk(['Hapana, mimi siishi Nairobi.', 'Oh, eh, sawa, mfike huko.', 'Mfike huko.']);
  assert.notEqual(r.out[0].line, r.out[1].line); assert.notEqual(r.out[1].line, r.out[2].line);
  assert.match(r.out[1].line, /^Maeneo yetu ni Nairobi/);
  const p = await talk(['How much is gutter cleaning?', 'How much is gutter cleaning?']);
  assert.doesNotMatch(p.out[1].line, /^(As I said|Just to repeat)/, 'a repeat is said plainly, no filler prefix');
});

test('place: area is the place, landmark is a note (EN/SW near, karibu na, pale, opposite)', async () => {
  const N = V2.nlu;
  const cases = [
    ['Kitengela, near Naivas', 'Kitengela', 'near Naivas'], ['Kitengela karibu na Naivas', 'Kitengela', 'karibu na Naivas'],
    ['Ruiru pale Total', 'Ruiru', 'pale Total'], ['Juja opposite the mall', 'Juja', 'opposite the mall'],
    ['Mimi niko Kasarani, opposite Mwiki stage.', 'Kasarani', 'opposite Mwiki stage'], ['Westlands', 'Westlands', null],
  ];
  for (const [t, place, lm] of cases) { assert.equal(N.extractPlace(t, { prompted: true }), place, t); assert.equal(N.extractLandmark(t), lm, t); }
  const en = await talk(["Hi, I'd like to book interior window cleaning for Friday at 10am.", 'My name is Alvin', 'Kitengela, near Naivas', 'Yes']);
  assert.match(en.out[2].line, /in Kitengela, near Naivas, for Alvin/); assert.doesNotMatch(en.out[2].line, /in Naivas/);
  const a = en.log.find((l) => l[0] === 'appt')[1]; assert.equal(a.landmark, 'Kitengela'); assert.equal(a.notes, 'near Naivas');
  const sw = await talk(['Nataka kusafisha madirisha Ijumaa saa nne asubuhi', 'Naitwa Alvin', 'Ruiru pale Total', 'Ndio']);
  assert.match(sw.out[2].line, /, Ruiru pale Total, kwa Alvin/);
  const b = sw.log.find((l) => l[0] === 'appt')[1]; assert.equal(b.landmark, 'Ruiru'); assert.equal(b.notes, 'pale Total');
});

const ACKRX = /^\s*(sawa sawa|sawa kabisa|ni sawa|sawa|okay|ok|haya|alright|sure|poa|asante)\s*[,.!]/i;
test('ack rule: only a write receipt may open with an ack; never after an ack; acked drops it', async () => {
  const a = await talk(['Habari, nataka kubook carpet cleaning kesho saa tatu asubuhi.', 'Wanjiru', 'Ruiru', 'Ndio.', 'Sawa.', 'Hapana, ni hayo tu.']);
  assert.match(a.out[3].line, /^Sawa, nimeweka/);
  assert.doesNotMatch(a.out[4].line, ACKRX, 'reply to caller sawa goes straight on');
  assert.match(a.out[5].line, /Kwaheri/);
  const b = await talk(['Habari, nataka kubook carpet cleaning kesho saa tatu asubuhi.', 'Wanjiru', 'Ruiru', 'Ndio.', 'Hapana, ni hayo tu.']);
  assert.equal(b.out[4].line, 'Karibu tena. Kwaheri.', 'goodbye is not paired with an ack-led receipt');
  for (let i = 1; i < a.out.length; i++) assert.ok(!(ACKRX.test(a.out[i].line) && ACKRX.test(a.out[i - 1].line)));
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] }); const h = V2.createDryRunHandlers(); let r;
  for (const text of ['Habari, nataka kubook carpet cleaning kesho saa tatu asubuhi.', 'Wanjiru', 'Ruiru']) await V2.runTurn(st, { text, profile: DD, now: NOW, handlers: h });
  r = await V2.runTurn(st, { text: 'Ndio.', profile: DD, now: NOW, handlers: h, acked: true });
  assert.match(r.line, /^Nimeweka Carpet Cleaning/);
  const q = await talk(['Mnafanya carpet?', 'Sawa.', 'Sawa.', 'Ok.']);
  for (const o of q.out) assert.doesNotMatch(o.line, ACKRX);
  const f = await talk(['Okay']); assert.doesNotMatch(f.out[0].line, ACKRX, 'no ack on first turn');
});

test('HD_513dfb2fa73f: "make a booking" + detail answers keep the booking going; no "As I said" filler', async () => {
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001' }); const h = V2.createDryRunHandlers(); const out = [];
  const lines = ["I'd like to meet— I'd like to make a booking for", 'My apartment to be washed.', '2-Bedroom— My name is Alvin Yegon.', 'Uh, 2-Bedroom, tomorrow.', "It's in— it's in Rongai.", '8, 8, 8 AM.', "It's in— it's in Simba Drive, and it's— the name is the Grace Apartments.", 'Yes'];
  for (const text of lines) out.push(await V2.runTurn(st, { text, profile: DD, now: new Date('2026-10-14T11:00:00Z'), handlers: h, langLock: 'en' }));
  for (const o of out) assert.doesNotMatch(o.line, /As I said|Just to repeat|Kama nilivyosema|Narudia|call you back to finish|calling to book/);
  assert.match(out[5].line, /2-Bedroom Apartment on Thursday 15 October at 08:00 in Rongai, for Alvin Yegon/);
  assert.match(out[6].line, /in Rongai, Simba Drive/);
  const a = h.log.find((l) => l.name === 'createAppointment').args;
  assert.equal(a.landmark, 'Rongai'); assert.equal(a.notes, 'Simba Drive'); assert.equal(a.whenText, '2026-10-15 08:00');
  // an offered service answered with a day is a yes to "Would you like to book?"
  const r = await talk(['Do you clean sofas?', 'Tomorrow at 10am please']);
  assert.match(r.out[1].line, /Where should we come|name|Shall I book/i);
});

function idHandlers() {
  const log = [];
  return { log, handlers: {
    createAppointment: async (a) => (log.push(['appt', a]), { id: 'apt_9' }),
    escalate: async (a) => (log.push(['esc', a]), { ok: true, id: 'esc_1', notify: 'queued' }),
    saveCallerInfo: async () => ({ ok: true }), updateAppointment: async (u) => ({ id: u.appointmentId }), createServiceRequest: async () => ({ id: 'sr_1' }),
  } };
}
async function run(lines, handlers, opts = {}) { const st = V2.createState({ profile: DD, callerPhone: '+254700000001', ...opts }); const out = []; for (const text of lines) out.push(await V2.runTurn(st, { text, profile: DD, now: NOW, handlers })); return { st, out }; }

test('HD_4ec204aafa93: a booking supersedes this call\'s open callback; one owner message with the final outcome', async () => {
  const { log, handlers } = idHandlers();
  const { st, out } = await run(['Can someone call me back please?', 'Yes', 'Actually, book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes', 'No thanks'], handlers);
  const appt = log.find((l) => l[0] === 'appt')[1];
  assert.deepEqual(appt.supersedes, ['esc_1']);
  assert.deepEqual(out[3].toolResults[0].supersedes, ['esc_1']);
  const fin = V2.finishCall(st, { businessName: 'DD', callerPhone: '+254700000001' });
  assert.equal(fin.outcome, 'booked'); assert.deepEqual(fin.superseded, ['esc_1']);
  assert.match(fin.ownerText, /Visit booked/); assert.match(fin.ownerText, /earlier callback request closed/);
  assert.doesNotMatch(fin.ownerText, /asked for a callback/);
});
test('HD_4ec204aafa93: a day without a time keeps collecting and never rescues to a callback', async () => {
  const { log, handlers } = idHandlers();
  const { out } = await run(['I want sofa cleaning on Friday in Kitengela, I am Alvin.', 'Friday', 'Yes Friday', 'Friday please', 'Friday'], handlers);
  assert.ok(!log.some((l) => l[0] === 'esc'), 'no callback written');
  for (const o of out) assert.doesNotMatch(o.line, /call you back/);
});
test('HD_db0e864043c1: no memory claim without file evidence; never "wewe ni nani"; pardon repeats; unlisted area offers one callback', async () => {
  const { handlers } = idHandlers();
  const a = await run(['Hi', 'Do you remember me? I have been talking to you for a while.', 'Kwa nikumbuka, naitwa nani?', 'Naitwa Alvin Yegon.'], handlers);
  assert.doesNotMatch(a.out[1].line, /remember you|nakukumbuka|ninakukumbuka/i);
  assert.match(a.out[2].line, /Sina jina lako bado\. Naomba jina lako\?/);
  assert.match(a.out[3].line, /^Alvin Yegon, unahitaji huduma gani leo\?/);
  const withFile = await run(['Kwa nikumbuka, naitwa nani?'], handlers, { contactName: 'Wanjiru' });
  assert.match(withFile.out[0].line, /Wanjiru/);
  const R = V2.receipts; const all = JSON.stringify([R.ask, R.info, R.readback, R.receipt].map((f) => f.toString()));
  assert.doesNotMatch(all, /wewe ni nani/i);
  const b = await run(['How much is sofa cleaning?', 'Uh, pardon me?'], handlers);
  assert.equal(b.out[1].line, b.out[0].line);
  const c = await run(['I want to book sofa cleaning.', 'Of Naivasha?', 'Yeah.', 'Oh, ume-escalatea nani specifically?'], handlers);
  assert.match(c.out[1].line, /Naivasha isn't on our list.*call you back/);
  assert.match(c.out[2].line, /call you back on this number/);
  assert.match(c.out[3].line, /asked the business team to call you back/);
  const d = await run(['Uh, and where do you serve, like, so that I know if I can place a booking?'], handlers);
  assert.match(d.out[0].line, /We serve/);
});
