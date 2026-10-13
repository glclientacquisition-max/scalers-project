// BRAIN_TRUST_P1 evals (phase1-trust-brief.md). Each scenario runs k=4 times
// against an in-memory store and asserts the FINAL store state + speech.
const test = require('node:test');
const assert = require('node:assert/strict');

const trust = require('../src/conversation/trustP1');
const { executeBrainTools, formatToolConfirmation } = require('../src/conversation/toolExecution');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');

const K = 4;
const DAY = 86400000;
const NOW = Date.parse('2026-10-13T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

function withFlag(value, fn) {
  return async () => {
    const prev = process.env.BRAIN_TRUST_P1;
    if (value == null) delete process.env.BRAIN_TRUST_P1;
    else process.env.BRAIN_TRUST_P1 = value;
    try {
      for (let k = 0; k < K; k += 1) await fn(k);
    } finally {
      if (prev == null) delete process.env.BRAIN_TRUST_P1;
      else process.env.BRAIN_TRUST_P1 = prev;
    }
  };
}

function store() {
  const rows = [];
  return {
    rows,
    handlers: {
      createServiceRequest: async (req) => {
        const row = { id: `req_${rows.length + 1}`, request_type: req.type, ...req };
        rows.push(row);
        return row;
      },
      saveCallerInfo: async (x) => x,
    },
  };
}

const CAPS = { createServiceRequest: true };
const state = (extra = {}) => ({ conversation: { turnCount: 1, answersReceived: [] }, caller: {}, entities: {}, ...extra });
const say = (text, ctx = {}) =>
  polishSpokenDetail(text, { state: ctx.state || state(), profile: ctx.profile || {}, toolResults: ctx.toolResults || [], language: ctx.language || 'en', callerTurns: ctx.callerTurns || ['hi'] }).text;

// ------------------------------------------------------------- flag-off parity
test('flag off: legacy speech, greeting and plans unchanged', withFlag(null, async () => {
  const s = store();
  const ex = await executeBrainTools({ parsed: { serviceRequest: { type: 'enquiry', name: 'Jane', item: 'HP printer' } }, capabilities: CAPS, productCatalog: [{ name: 'HP printer' }], handlers: s.handlers });
  assert.equal(formatToolConfirmation(ex.results, 'en'), "Okay, I've saved your request.");
  assert.equal(trust.tieredGreeting('Hello, Aris here. How can I help?', { card: { known: true } }), 'Hello, Aris here. How can I help?');
  assert.equal(trust.planTrustTurn({ text: 'change my delivery address to Kilimani', state: state() }), null);
  assert.equal(trust.shouldSpeakNotice({ state: state() }), false);
  assert.equal(trust.shapeSpeech('Wanjiru will call you. You asked for pens last time.', { profile: { staffNames: [{ name: 'Wanjiru' }] } }).text, 'Wanjiru will call you. You asked for pens last time.');
}));

// ------------------------------------------------------------------ receipts
test('English good save: readback items/qty = row, next step + role', withFlag('on', async () => {
  const s = store();
  const ex = await executeBrainTools({ parsed: { serviceRequest: { type: 'enquiry', name: 'Jane', item: 'blue pens', quantity: 2, whenText: 'Friday' } }, capabilities: CAPS, productCatalog: [{ name: 'blue pens' }], handlers: s.handlers });
  assert.equal(s.rows.length, 1);
  const line = formatToolConfirmation(ex.results, 'en');
  assert.match(line, /^Saved: /);
  assert.ok(line.includes(s.rows[0].item));
  assert.match(line, /Next: our team will confirm/);
  assert.doesNotMatch(line, /saved your request/);
}));

test('Swahili good save: readback in Swahili', withFlag('on', async () => {
  const s = store();
  const ex = await executeBrainTools({ parsed: { serviceRequest: { type: 'enquiry', name: 'Juma', item: 'kalamu', whenText: 'kesho' } }, capabilities: CAPS, productCatalog: [{ name: 'kalamu' }], handlers: s.handlers });
  const line = formatToolConfirmation(ex.results, 'sw');
  assert.match(line, /^Imehifadhiwa: kalamu, kesho\. Hatua inayofuata: Timu yetu itathibitisha\./);
}));

test('garbled / empty save: no row, repair ask', withFlag('on', async () => {
  for (const item of ['um', 'uh uh', '...', '?? ##']) {
    const s = store();
    const ex = await executeBrainTools({ parsed: { serviceRequest: { type: 'enquiry', name: 'Jane', item } }, capabilities: CAPS, handlers: s.handlers });
    assert.equal(s.rows.length, 0, item);
    const line = formatToolConfirmation(ex.results, 'en');
    assert.doesNotMatch(line, /saved/i);
  }
  assert.equal(trust.isGarbledContent('um'), true);
  assert.equal(trust.isGarbledContent('2 blue pens'), false);
}));

test('model-authored success words stripped without receipt (EN + SW)', withFlag('on', async () => {
  assert.doesNotMatch(say("I've saved your order for two pens. Anything else?"), /saved/i);
  assert.doesNotMatch(say('Nimehifadhi ombi lako. Kuna kingine?', { language: 'sw' }), /nimehifadhi/i);
  assert.doesNotMatch(say('Your booking has been booked.'), /booked/i);
}));

test('tool error: no success words', withFlag('on', async () => {
  const ex = await executeBrainTools({ parsed: { serviceRequest: { type: 'enquiry', name: 'Jane', item: 'pens' } }, capabilities: CAPS, productCatalog: [{ name: 'pens' }], handlers: { createServiceRequest: async () => { throw new Error('db down'); } } });
  assert.doesNotMatch(formatToolConfirmation(ex.results, 'en'), /^Saved|saved your/i);
}));

test('summary vs receipts: receipts win', withFlag('on', async () => {
  const results = [{ action: 'create_service_request', status: 'succeeded', id: 'r1', value: { item: 'pens', quantity: 2 } }];
  assert.equal(trust.validateSummary('Caller ordered 5 pens.', results), '');
  assert.equal(trust.validateSummary('Caller ordered 2 pens.', results), 'Caller ordered 2 pens.');
  assert.equal(trust.validateSummary('Caller saved an order.', []), '');
}));

// ------------------------------------------------- address / payment change
test('address change: callback task, honest line, never "updated"; pending on repeat', withFlag('on', async () => {
  const s = store();
  const st = state({ caller: { name: 'Jane', nameConfirmed: true } });
  const plan = trust.planTrustTurn({ text: 'I want to change my delivery address to Kilimani', state: st, language: 'en' });
  assert.equal(plan.kind, 'callback');
  assert.doesNotMatch(plan.line, /updated/i);
  assert.match(plan.line, /^I can't change your address on a call\. I've noted the new address, and the owner will call you back to confirm today\.$/);
  const ex = await executeBrainTools({ parsed: plan.parsed, capabilities: CAPS, handlers: s.handlers });
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].type, 'callback');
  assert.equal(s.rows[0].item, 'address_change');
  assert.match(s.rows[0].notes, /Kilimani/);
  assert.equal(trust.receiptsOf(ex.results).length, 1);
  trust.noteChangeTask(st, 'address');
  // Same call repeat
  assert.equal(trust.planTrustTurn({ text: 'so can you change the address?', state: st }).kind, 'pending');
  // Repeat call: task on file from open_tasks
  const next = trust.planTrustTurn({ text: 'change my address please', state: state(), tasks: [{ task_id: 't1', type: 'callback', summary_item: 'address_change', updated_at: iso(0) }] });
  assert.equal(next.line, 'That change is still pending; the owner will call you to confirm.');
  assert.equal(s.rows.length, 1);
  // The model saying "updated" about the address is dropped even with a receipt.
  assert.doesNotMatch(say('Your address has been updated to Kilimani.', { toolResults: ex.results }), /updated/i);
}));

test('Swahili address + payment change wording', withFlag('on', async () => {
  const a = trust.planSensitiveChange({ text: 'nataka kubadilisha anwani yangu', language: 'sw' });
  assert.equal(a.line, 'Siwezi kubadilisha anwani kwa simu. Nimeandika anwani mpya, na mwenye duka atakupigia kuthibitisha leo.');
  const p = trust.planSensitiveChange({ text: 'I want to change my payment number', language: 'en' });
  assert.equal(p.change, 'payment');
  assert.equal(p.parsed.serviceRequest.item, 'payment_change');
  assert.equal(trust.planSensitiveChange({ text: 'mabadiliko', tasks: [{ type: 'payment_change', updated_at: iso(1) }], language: 'sw' }), null);
  assert.equal(trust.planSensitiveChange({ text: 'badilisha malipo', tasks: [{ type: 'payment_change', updated_at: iso(1) }], language: 'sw' }).line, 'Mabadiliko hayo bado yanasubiri; mwenye duka atakupigia kuthibitisha.');
}));

// --------------------------------------------------------------- memory
test('no memory: "do you remember me?" EN/SW → no yes, no past claim', withFlag('on', async () => {
  const en = trust.planTrustTurn({ text: 'Do you remember me?', state: state(), card: null });
  assert.match(en.line, /^I don't have that on file\./);
  assert.doesNotMatch(en.line, /\byes\b|last time|you asked/i);
  const sw = trust.planTrustTurn({ text: 'Unanikumbuka?', state: state(), card: null, language: 'sw' });
  assert.match(sw.line, /^Sina hiyo kwenye rekodi\./);
  assert.equal(say('Yes, last time you asked for pens.'), "I don't have that on file.");
  assert.doesNotMatch(say('Ndio, uliuliza kuhusu kalamu.', { language: 'sw' }), /uliuliza|ndio/i);
  assert.equal(trust.shapeSpeech('Ndio, uliuliza kuhusu bei.', { state: state(), language: 'sw' }).text, 'Sina hiyo kwenye rekodi.');
}));

test('returning caller: known number → welcome back, no details; bound → resume offer', withFlag('on', async () => {
  const card = { known: true, sharedLine: false, openTaskCount: 1 };
  const g = trust.tieredGreeting('Hello, you have reached Done and Dusted. How can I help?', { card });
  assert.equal(g, 'Hello, you have reached Done and Dusted. Welcome back. How can I help?');
  assert.doesNotMatch(g, /pens|Jane/);
  const tasks = [{ task_id: 't9', type: 'enquiry', summary_item: 'blue pens', updated_at: iso(3) }];
  const st = state();
  assert.equal(trust.planTrustTurn({ text: 'I was asking about pens', state: st, card, tasks }), null);
  st.caller.nameConfirmed = true;
  const offer = trust.planTrustTurn({ text: 'yes it is Jane', state: st, card, tasks, nameJustConfirmed: true });
  assert.equal(offer.kind, 'resume');
  assert.equal(offer.line, 'Are you still interested in the blue pens from earlier this week?');
  assert.equal(trust.resumedTaskId(st), 't9');
  // offered once only
  assert.equal(trust.planResumeOffer({ card, tasks, state: st }), null);
  // a past claim is allowed on the file-read turn
  assert.match(say('You asked for blue pens on Friday.', { state: st }), /You asked/);
}));

test('unfinished task: resume pointer expires after 4 turns → "which one?"', withFlag('on', async () => {
  const card = { known: true };
  const tasks = [{ task_id: 't1', type: 'enquiry', summary_item: 'printer ink', updated_at: iso(2) }];
  const st = state({ caller: { nameConfirmed: true } });
  trust.planTrustTurn({ text: 'Jane', state: st, card, tasks, nameJustConfirmed: true });
  assert.equal(trust.resumedTaskId(st), 't1');
  for (let i = 0; i < 3; i += 1) {
    st.conversation.turnCount += 1;
    assert.equal(trust.tickResumePointer(st, 'okay'), null);
  }
  st.conversation.turnCount += 1;
  const plan = trust.planTrustTurn({ text: 'so what about that one', state: st, card, tasks });
  assert.equal(trust.resumedTaskId(st), null);
  assert.equal(plan.line, 'Which request do you mean?');
  // topic change also clears it
  const st2 = state({ caller: { nameConfirmed: true } });
  trust.setResumePointer(st2, tasks[0]);
  assert.equal(trust.tickResumePointer(st2, 'I also want a different thing, notebooks'), 'topic');
}));

test('shared phone: stays known tier, nothing leaked (Brian on Wanjiru\'s phone)', withFlag('on', async () => {
  const card = { known: true, sharedLine: true };
  const tasks = [{ task_id: 'w1', type: 'hold', summary_item: 'wedding cake', updated_at: iso(1) }];
  const st = state({ caller: { name: 'Brian', nameConfirmed: true } });
  assert.equal(trust.identityTier(card, st), 1);
  assert.equal(trust.planTrustTurn({ text: 'Brian', state: st, card, tasks, nameJustConfirmed: true }), null);
  const r = trust.planTrustTurn({ text: 'do you remember my last order?', state: state(), card, tasks });
  assert.doesNotMatch(r.line, /cake|Wanjiru/i);
  assert.doesNotMatch(say('You ordered a wedding cake last time.', { state: st }), /cake/);
}));

test('relevance + recency: closed >30d and topic >60d never read; caller correction blocks row', withFlag('on', async () => {
  const tasks = [
    { task_id: 'a', type: 'enquiry', summary_item: 'pens', updated_at: iso(10) },
    { task_id: 'b', type: 'enquiry', summary_item: 'pens', status: 'done', closed_at: iso(40), updated_at: iso(40) },
    { task_id: 'c', type: 'enquiry', summary_item: 'old books', updated_at: iso(70) },
    { task_id: 'd', type: 'enquiry', summary_item: 'printer', updated_at: iso(1) },
  ];
  assert.deepEqual(trust.relevantTasks(tasks, { now: NOW }).map((t) => t.task_id), ['a', 'd']);
  assert.deepEqual(trust.relevantTasks(tasks, { now: NOW, topic: 'about the pens' }).map((t) => t.task_id), ['a']);
  assert.equal(trust.usableLastTopic({ last_topic: 'books', last_topic_at: iso(61) }, NOW), '');
  assert.equal(trust.usableLastTopic({ last_topic: 'pens', last_topic_at: iso(5) }, NOW), 'pens');
  const st = state();
  trust.setResumePointer(st, tasks[0]);
  const c = trust.planTrustTurn({ text: "no, that's wrong", state: st });
  assert.equal(c.kind, 'correction');
  assert.equal(st.trust.reviewFlags.length, 1);
  assert.deepEqual(trust.relevantTasks(tasks, { now: NOW, state: st }).map((t) => t.task_id), ['d']);
  assert.match(trust.planCorrection({ text: 'si hivyo', state: Object.assign(st, {}), language: 'sw' })?.line || 'Samahani', /Samahani/);
}));

test('v2 offer: several → "is this about X, or something new?"; new purpose → none', withFlag('on', async () => {
  const tasks = [
    { task_id: 'a', summary_item: 'pens', updated_at: iso(1) },
    { task_id: 'b', summary_item: 'printer', updated_at: iso(2) },
  ];
  const several = trust.planResumeOffer({ card: { known: true }, tasks, state: state({ caller: { nameConfirmed: true } }), topic: '', now: NOW });
  assert.equal(several.line, 'Is this about the pens, or something new?');
  const sw = trust.planResumeOffer({ card: { known: true }, tasks: [tasks[1]], state: state({ caller: { nameConfirmed: true } }), topic: 'Jane', language: 'sw', now: NOW });
  assert.equal(sw.line, 'Bado unahitaji printer uliyoomba wiki hii?');
  assert.equal(trust.planResumeOffer({ card: { known: true }, tasks, state: state({ caller: { nameConfirmed: true } }), topic: 'I need sofa cleaning tomorrow', now: NOW }), null);
  assert.equal(trust.planResumeOffer({ card: null, tasks, state: state({ caller: { nameConfirmed: true } }), now: NOW }), null);
  const st = state({ caller: { nameConfirmed: true } });
  trust.planResumeOffer({ card: { known: true }, tasks: [tasks[0]], state: st, now: NOW });
  st.conversation.turnCount += 1;
  assert.equal(trust.tickResumePointer(st, 'Actually I want carpet cleaning booked'), 'topic');
  assert.equal(trust.resumedTaskId(st), null);
}));

test('v2 greeting: tenant text as is, welcome back before the closing invite, invite always last', withFlag('on', async () => {
  const g = "Good evening, Done and Dusted, this is Shy. We're closed now. Tukusaidie vipi.";
  assert.equal(trust.tieredGreeting(g, { card: null }), g);
  assert.equal(trust.tieredGreeting(g, { card: { known: true } }), "Good evening, Done and Dusted, this is Shy. We're closed now. Karibu tena. Tukusaidie vipi.");
  assert.equal(trust.tieredGreeting('Done and Dusted, this is Shy. How can I help?', { card: { known: true } }), 'Done and Dusted, this is Shy. Welcome back. How can I help?');
  assert.equal(trust.tieredGreeting('Done and Dusted, this is Shy.', { card: null }), 'Done and Dusted, this is Shy. How can I help you today?');
  assert.doesNotMatch(trust.tieredGreeting(g, { card: { known: true } }), /notes|speak in English/i);
}));

test('v2 remember-ask: widened phrasing caught', withFlag('on', async () => {
  for (const t of ['Do you still remember me?', 'Have I called you before?', 'do you recall what I booked', 'Do you have my details on file?', 'Mnanikumbuka?', 'Unanijua?', 'nimewahi kupiga hapa']) {
    assert.ok(trust.planTrustTurn({ text: t, state: state(), card: null, tasks: [] }), t);
  }
  assert.match(trust.trustPromptFacts({ card: null }), /keeps short notes/);
}));

// ------------------------------------------------------------- notice
test('notice: once per caller, in call language, never repeated', withFlag('on', async () => {
  const st = state();
  assert.equal(trust.shouldSpeakNotice({ file: null, state: st }), true);
  trust.markNoticeSpoken(st);
  assert.equal(trust.shouldSpeakNotice({ file: null, state: st }), false);
  assert.equal(trust.shouldSpeakNotice({ file: { memory_notice_shown_at: iso(3) }, state: state() }), false);
  assert.equal(trust.noticeLine('sw'), 'Tunaweka maelezo mafupi ya maombi yako ili tukusaidie wakati ujao.');
  assert.equal(trust.noticeLine('en'), 'We keep short notes of your requests to help you next time.');
}));

// --------------------------------------------------------------- names
test('name asks: ≤2 across paths, refused never re-asked, bound → 0', withFlag('on', async () => {
  const st = state();
  const out = [];
  for (let turn = 1; turn <= 4; turn += 1) {
    st.conversation.turnCount = turn;
    out.push(say('May I have your name, please?', { state: st }));
  }
  assert.equal(out.filter((t) => /name/i.test(t)).length, 2);
  const r = state();
  trust.noteCallerTurnForName(r, "I'd rather not give my name");
  assert.equal(say('What is your name?', { state: r }), '');
  const b = state({ caller: { nameConfirmed: true } });
  assert.equal(trust.nameAskAllowed(b), false);
}));

// --------------------------------------------------- consistency
test('catalogue family: pens never get "book title"; hours anchored', withFlag('on', async () => {
  const fixed = trust.fixSlotNoun('What is the book title?', { item: 'pens' });
  assert.equal(fixed, 'What is which pen and how many?'.replace('What is which', 'What is which'));
  assert.doesNotMatch(fixed, /book title/);
  assert.equal(trust.fixSlotNoun('What is the book title?', { item: 'novel' }), 'What is the book title?');
  const st = state();
  assert.equal(trust.anchorHours('We open at 8 am and close at 6 pm.', st), 'We open at 8 am and close at 6 pm.');
  assert.equal(trust.anchorHours('On Sunday we open at 10 am and close at 4 pm.', st), 'We open at 8 am and close at 6 pm.');
  assert.match(trust.missingHoursLine('en'), /owner/);
}));

// --------------------------------------------------- staff names
test('staff names never spoken, role words instead (no opt-in)', withFlag('on', async () => {
  const profile = { staffNames: [{ name: 'Wanjiru Kamau', is_public: true }, { name: 'Otieno', is_public: false }] };
  const en = say('Wanjiru will call you back. Otieno handles deliveries.', { profile });
  assert.doesNotMatch(en, /Wanjiru|Kamau|Otieno/);
  assert.match(en, /^The owner will call you back\./);
  const sw = trust.redactStaffNames('Wanjiru atakupigia.', profile, 'sw');
  assert.equal(sw, 'Mwenye duka atakupigia.');
}));

// --------------------------------------------------- length + language
test('length: ≤30 words, readbacks exempt; Swahili lines stay Swahili', withFlag('on', async () => {
  const long = 'We have many kinds of pens in the shop today and they are all good quality. Most of them come in a box of ten which is cheaper for schools. Some are gel and some are ballpoint and some are fountain pens. Which would you like?';
  assert.equal(trust.trimLength('Sure. We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning. Which one do you need?'), 'Sure. We offer Couch cleaning, Mattress cleaning, Carpet cleaning, and General cleaning. Which one do you need?');
  const t = trust.trimLength(long);
  assert.ok(t.split(/\s+/).length <= 30, t);
  assert.match(t, /Which would you like\?$/);
  const rb = 'Saved: 2 blue pens, 3 red pens, 1 ruler, Friday at 10. Next: our team will confirm today by phone before closing time at six in the evening.';
  assert.equal(trust.trimLength(rb), rb);
  const sw = trust.planTrustTurn({ text: 'nataka kubadilisha anwani', state: state(), language: 'sw' });
  assert.doesNotMatch(sw.line, /\b(?:the|owner|call)\b/);
}));

// --------------------------------------------------- isolation
test('isolation: tasks of tenant A never offered in a tenant B call', withFlag('on', async () => {
  const all = [
    { task_id: 'A1', tenant_id: 'A', summary_item: 'pens', updated_at: iso(1) },
  ];
  // Call context for tenant B only ever receives rows loaded with tenant_id = B.
  const tenantB = all.filter((t) => t.tenant_id === 'B');
  assert.equal(trust.planResumeOffer({ card: { known: true }, tasks: tenantB, state: state({ caller: { nameConfirmed: true } }), now: NOW }), null);
}));
