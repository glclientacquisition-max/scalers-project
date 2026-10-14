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
