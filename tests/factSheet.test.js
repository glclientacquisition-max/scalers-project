'use strict';
// VOICE_FACT_REFS (option B): fact IDs on a FACT CARD, values put in by code in
// the caller's language, an unconfirmed fact spoken as "let me confirm that
// with the owner", and the Phase 1 speech-check fixes that ride with it
// (digits in the prompt, compound number words, the saved value on a failed
// check, saves from any earlier turn). Seams: factSheet's public functions,
// the prompt builder, the spoken stream buffer, and the speech path
// (polishSpokenDetail). Expected values are written out by hand.
const test = require('node:test');
const assert = require('node:assert/strict');

const factSheet = require('../src/conversation/factSheet');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { createBrainState } = require('../src/conversation/brainState');
const { createSpokenStreamBuffer } = require('../src/speech/spokenStreamBuffer');
const { numbersIn } = require('../src/conversation/numberWords');

function withFlag(value, fn) {
  // Off means fully off: VOICE_AREA_FEES also turns compound numbers on, so
  // clear it too (a suite run with both flags on must not leak in).
  const prev = { refs: process.env.VOICE_FACT_REFS, fees: process.env.VOICE_AREA_FEES };
  const restore = (name, v) => (v == null ? delete process.env[name] : (process.env[name] = v));
  if (value == null) {
    delete process.env.VOICE_FACT_REFS;
    delete process.env.VOICE_AREA_FEES;
  } else process.env.VOICE_FACT_REFS = value;
  try {
    return fn();
  } finally {
    restore('VOICE_FACT_REFS', prev.refs);
    restore('VOICE_AREA_FEES', prev.fees);
  }
}

// Owner-confirmed sofa price, a seed (unconfirmed) carpet price, one confirmed
// and one "ask" area fee, Mon-Fri hours, and a confirmed M-Pesa till.
function shopProfile(extra = {}) {
  return {
    businessName: 'Usafi Bora',
    agentName: 'Neema',
    servicesCatalog: [
      { name: 'Sofa cleaning', price_range: 'KSh 1,500 per seat', source: 'owner', confirmed: true },
      { name: 'Carpet cleaning', price_range: 'KSh 300 per sq m', source: 'seed' },
    ],
    productCatalog: [],
    hoursSchedule: {
      days: {
        mon: { open: '08:00', close: '18:00' },
        tue: { open: '08:00', close: '18:00' },
        wed: { open: '08:00', close: '18:00' },
        thu: { open: '08:00', close: '18:00' },
        fri: { open: '08:00', close: '18:00' },
        sat: { open: '09:00', close: '13:00' },
        sun: null,
      },
    },
    businessPolicies: { payment: 'M-Pesa till 123456', payments: { methods: ['mpesa_till'], mpesa_till: '123456' } },
    areaTerms: {
      areas: [
        { id: 'place:kileleshwa', name: 'Kileleshwa', kind: 'travel', feeMode: 'fixed', feeKsh: 300, trusted: true },
        { id: 'place:karen', name: 'Karen', kind: 'travel', feeMode: 'ask', feeKsh: null, trusted: false },
      ],
    },
    ...extra,
  };
}

const speak = (text, opts = {}) =>
  polishSpokenDetail(text, {
    state: opts.state || createBrainState(),
    profile: opts.profile || shopProfile(),
    language: opts.language || 'en',
    callerTurns: [opts.caller || ''],
  });

test('flag reads only on/1/true/yes', () => {
  assert.equal(factSheet.factRefsEnabled({}), false);
  assert.equal(factSheet.factRefsEnabled({ VOICE_FACT_REFS: 'off' }), false);
  assert.equal(factSheet.factRefsEnabled({ VOICE_FACT_REFS: 'on' }), true);
  assert.equal(factSheet.factRefsEnabled({ VOICE_FACT_REFS: '1' }), true);
});

test('FACT CARD lists prices, then area fees, hours and payment numbers; unconfirmed facts carry no value', () => {
  const card = factSheet.formatFactCard(factSheet.buildFactSheet(shopProfile()));
  const order = ['PRICES:', 'AREA FEES:', 'HOURS:', 'PAYMENT NUMBERS:'].map((h) => card.indexOf(h));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), card);
  assert.match(card, /\{price\.sofa_cleaning\} Sofa cleaning: KSh 1,500 per seat/);
  assert.match(card, /\{price\.carpet_cleaning\} Carpet cleaning: \(owner to confirm\)/);
  assert.doesNotMatch(card, /KSh 300 per sq m/);
  assert.match(card, /\{fee\.kileleshwa\} Kileleshwa travel fee: KSh 300/);
  assert.match(card, /\{fee\.karen\} Karen: \(owner to confirm\)/);
  assert.match(card, /\{hours\.week\} Opening hours: Monday to Friday 8:00 AM to 6:00 PM; Saturday 9:00 AM to 1:00 PM; Sunday closed/);
  assert.match(card, /\{hours\.sun\} Sunday: closed/);
  assert.match(card, /\{pay\.mpesa_till\} M-Pesa till number: 123456/);
});

test('a payment number is not a fact until the owner confirmed the payment policy', () => {
  const profile = shopProfile({ businessPolicies: { payments: { methods: ['mpesa_till'], mpesa_till: '123456' } } });
  const sheet = factSheet.buildFactSheet(profile);
  assert.equal(sheet.facts.get('pay.mpesa_till').confirmed, false);
  assert.match(factSheet.formatFactCard(sheet), /\{pay\.mpesa_till\} M-Pesa till number: \(owner to confirm\)/);
});

test('renderFactRefs: values in, unconfirmed or unknown IDs become the owner-confirm line in the caller language', () => {
  const sheet = factSheet.buildFactSheet(shopProfile());
  assert.equal(
    factSheet.renderFactRefs('Sofa cleaning is {price.sofa_cleaning}. Shall I note it?', sheet, { language: 'en' }).text,
    'Sofa cleaning is KSh 1,500 per seat. Shall I note it?'
  );
  assert.equal(
    factSheet.renderFactRefs('Tunafungua {hours.mon}.', sheet, { language: 'sw' }).text,
    'Tunafungua 8:00 AM hadi 6:00 PM.'
  );
  assert.equal(
    factSheet.renderFactRefs('Karen is {fee.karen}. Anything else?', sheet, { language: 'en' }).text,
    'Let me confirm that with the owner and get back to you. Anything else?'
  );
  assert.equal(
    factSheet.renderFactRefs('Carpet ni {price.carpet_cleaning}.', sheet, { language: 'sw' }).text,
    'Wacha nithibitishe hilo na mwenye biashara kisha nikujulishe.'
  );
  const unknown = factSheet.renderFactRefs('That is {price.unicorn_wash}.', sheet, { language: 'en' });
  assert.equal(unknown.text, 'Let me confirm that with the owner and get back to you.');
  assert.deepEqual(unknown.unknown, ['price.unicorn_wash']);
  // A broken reference never reaches the caller as braces.
  assert.equal(
    factSheet.renderFactRefs('It is {price}.', sheet, { language: 'en' }).text,
    'Let me confirm that with the owner and get back to you.'
  );
});

test('speech path, flag on: references speak the owner value and survive the speech check', () => {
  withFlag('on', () => {
    assert.equal(speak('The travel fee to Kileleshwa is {fee.kileleshwa}.').text, 'The travel fee to Kileleshwa is KSh 300.');
    assert.equal(speak('Pay to till {pay.mpesa_till}.').text, 'Pay to till 123456.');
    assert.equal(speak('Saa zetu ni {hours.week}.', { language: 'sw' }).text,
      'Saa zetu ni Jumatatu hadi Ijumaa 8:00 AM hadi 6:00 PM; Jumamosi 9:00 AM hadi 1:00 PM; Jumapili tumefunga.');
  });
});

test('speech path, flag on: a wrong model price is replaced by the saved value, not silence', () => {
  withFlag('on', () => {
    const res = speak('Sofa cleaning costs KSh 2,000.', { caller: 'how much is sofa cleaning' });
    assert.equal(res.text, 'Sofa cleaning is KSh 1,500 per seat.');
    assert.deepEqual(res.dropReasons, ['unsaid_number']);
  });
});

test('speech path, flag on: a guessed number with no fact behind it gets the owner-confirm line instead of silence', () => {
  withFlag('on', () => {
    assert.equal(
      speak('We have 4 vans ready.', { caller: 'sawa' }).text,
      'Let me confirm that with the owner and get back to you.'
    );
  });
  withFlag(null, () => {
    assert.equal(speak('We have 4 vans ready.', { caller: 'sawa' }).text, '');
  });
});

test('speech path, flag on: an unasked guess beside other speech is just dropped, and a time ask never gets the owner line', () => {
  withFlag('on', () => {
    assert.equal(
      speak('We clean offices too. We have 4 vans ready. Anything else?', { caller: 'do you clean offices' }).text,
      'We clean offices too. Anything else?'
    );
    assert.doesNotMatch(speak('It is 4:10 PM.', { caller: "what's the time?" }).text, /confirm that with the owner/);
  });
});

test('speech path: a Swahili compound price on file is kept with the flag on, dropped as before with it off', () => {
  const line = 'Kusafisha sofa ni shilingi elfu moja na mia tano kwa kiti.';
  withFlag('on', () => {
    assert.equal(speak(line, { language: 'sw', caller: 'sofa ni bei gani' }).text, line);
  });
  withFlag(null, () => {
    assert.notEqual(speak(line, { language: 'sw', caller: 'sofa ni bei gani' }).text, line);
  });
});

test('compound number words are read as one amount only when the flag is on', () => {
  withFlag('on', () => {
    assert.deepEqual([...numbersIn('ada ni shilingi mia tatu')], ['300']);
    assert.deepEqual([...numbersIn('three thousand five hundred shillings')], ['3500']);
  });
  withFlag(null, () => {
    assert.deepEqual([...numbersIn('ada ni shilingi mia tatu')].sort(), ['100', '3']);
  });
});

test('saved claims: a request saved on an earlier turn backs the claim with the flag on; no save still drops', () => {
  const savedState = () => {
    const state = createBrainState();
    state.actions.savedWork = [{ action: 'create_service_request', status: 'succeeded' }];
    return state;
  };
  const line = 'Ndiyo Chris, nimeandika penseli.';
  withFlag('on', () => {
    assert.equal(speak(line, { language: 'sw', state: savedState(), caller: 'Umeandika pencils?' }).text, line);
    assert.notEqual(speak(line, { language: 'sw', caller: 'Umeandika pencils?' }).text, line);
  });
  withFlag(null, () => {
    assert.notEqual(speak(line, { language: 'sw', state: savedState(), caller: 'Umeandika pencils?' }).text, line);
  });
});

test('stream buffer holds an unfinished reference so a chunk never ends inside the braces', () => {
  withFlag('on', () => {
    const buf = createSpokenStreamBuffer();
    assert.deepEqual(buf.push('Sofa cleaning is {price.'), []);
    assert.deepEqual(buf.push('sofa_cleaning}. Want it?'), ['Sofa cleaning is {price.sofa_cleaning}.', 'Want it?']);
    assert.deepEqual(buf.finish(), []);
  });
  withFlag(null, () => {
    // Today's buffer: "{price." reads as a sentence end.
    assert.deepEqual(createSpokenStreamBuffer().push('Sofa cleaning is {price.'), ['Sofa cleaning is {price.']);
  });
});

test('prompt, flag on: FACT CARD, digits rule, and the compiled prompt used for persona only', () => {
  const { buildSystemPrompt } = require('../src/prompts');
  const profile = shopProfile({
    llmSystemPrompt: [
      'You are Neema, the live phone business assistant for Usafi Bora in Kenya.',
      'IDENTITY:',
      '- Warm and brief. Match the caller.',
      'BUSINESS KNOWLEDGE:',
      '- Services & pricing:',
      '  Sofa cleaning KSh 1,200 per seat',
      '- Hours & location: Mon-Fri 7:00-17:00, Westlands',
      'CONVERSATION:',
      '- Old promo: carpets at KSh 250 this week.',
      '- Ask one question at a time.',
    ].join('\n'),
  });
  const now = new Date('2026-10-19T07:00:00Z');
  withFlag('on', () => {
    const prompt = buildSystemPrompt(profile, { now });
    assert.match(prompt, /FACT CARD \(prices, fees, hours and payment numbers: use these IDs\):/);
    assert.match(prompt, /Write money as digits \("KSh 5,000"\), never as words/);
    assert.doesNotMatch(prompt, /Say money as words when you can/);
    assert.doesNotMatch(prompt, /saa 3 jioni/);
    assert.match(prompt, /PERSONA \(tone, identity and conversation style only\)/);
    assert.match(prompt, /Warm and brief\. Match the caller\./);
    assert.match(prompt, /Ask one question at a time\./);
    assert.doesNotMatch(prompt, /KSh 1,200/);
    assert.doesNotMatch(prompt, /KSh 250/);
    assert.doesNotMatch(prompt, /7:00-17:00/);
  });
  withFlag(null, () => {
    const prompt = buildSystemPrompt(profile, { now });
    assert.doesNotMatch(prompt, /FACT CARD/);
    assert.match(prompt, /Say money as words when you can/);
    assert.match(prompt, /KSh 1,200/);
  });
});

test('replay eval: fewer false deletions, no false "not on file", nothing wrongly kept that was blocked before', () => {
  const { runEval } = require('../scripts/eval-fact-refs');
  const { before, after } = runEval();
  assert.equal(before.totals.cases, 69);
  assert.equal(before.totals.falseDeletions, 34);
  assert.equal(before.totals.falseNotOnFile, 6);
  assert.ok(after.totals.falseDeletions <= 13, `after false deletions ${after.totals.falseDeletions}`);
  assert.equal(after.totals.falseNotOnFile, 0);
  assert.ok(after.totals.wronglyKept <= before.totals.wronglyKept);
  for (let i = 0; i < after.rows.length; i += 1) {
    if (before.rows[i].expect === 'drop' && !before.rows[i].kept) {
      assert.equal(after.rows[i].kept, false, `${after.rows[i].id} must stay blocked`);
    }
  }
});

test('a "From" price reads mid-sentence in both languages', () => {
  const sheet = factSheet.buildFactSheet({
    servicesCatalog: [{ name: 'Sofa cleaning', price_range: 'From KSh 2,500' }],
  });
  const fact = sheet.facts.get('price.sofa_cleaning');
  assert.ok(fact, 'sofa price fact exists');
  fact.confirmed = true;
  assert.equal(factSheet.renderFactRefs('Sofa cleaning is {price.sofa_cleaning}.', sheet, { language: 'en' }).text, 'Sofa cleaning is from KSh 2,500.');
  assert.equal(factSheet.renderFactRefs('Sofa ni {price.sofa_cleaning}.', sheet, { language: 'sw' }).text, 'Sofa ni kuanzia KSh 2,500.');
});
