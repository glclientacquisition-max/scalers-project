// Unit tests for TTS pronunciation prep (Slices 1–6).
// Run: node tests/ttsNormalize.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  prepareForTts,
  resolveTtsLanguage,
  detectUtteranceTtsLang,
  normalizeForTts,
} = require('../src/speech/ttsNormalize');
const {
  applyLexicon,
  listLexiconEntries,
  parseLexiconOverrides,
  sanitizeSayForm,
} = require('../src/speech/pronunciationLexicon');
const {
  expandMoney,
  expandBarePriceInContext,
  expandSpokenForms,
  expandTimes,
  expand24HourTime,
  expandDayRanges,
  expandPhones,
  numberToSw,
} = require('../src/speech/spokenForms');
const { rewriteShengForTts, shouldRewriteSheng } = require('../src/speech/shengRewrite');
const { speedForLanguage } = require('../src/speech/sonioxTts');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('pronunciationLexicon');
test('seeds Kenya brands/places/services', () => {
  const entries = listLexiconEntries();
  assert.ok(entries.length >= 30, `expected >=30 entries, got ${entries.length}`);
  const matches = entries.map((e) => e.match).join(' ');
  assert.ok(matches.includes('m-?pesa'));
  assert.ok(matches.includes('ruiru'));
  assert.ok(matches.includes('whatsapp'));
  assert.ok(matches.includes('geyser'));
});

test('applies brand + place rewrites', () => {
  const out = applyLexicon('Pay via mpesa near Ruiru CBD', 'en');
  assert.match(out, /M-Pesa/);
  assert.match(out, /Roo-ee-roo/);
  assert.match(out, /C B D/);
});

test('tenant overrides win over defaults', () => {
  const out = applyLexicon('Meet Wanjiku in Ruiru', 'en', [
    { match: 'wanjiku', say: 'Wan-jee-koo', priority: 200 },
  ]);
  assert.match(out, /Wan-jee-koo/);
  assert.match(out, /Roo-ee-roo/);
});

test('parseLexiconOverrides validates JSON', () => {
  const parsed = parseLexiconOverrides(
    '[{"match":"kamau","say":"Kah-mau"},{"match":"","say":"x"}]'
  );
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].say, 'Kah-mau');
});

console.log('spokenForms');
test('expandMoney EN/SW', () => {
  assert.match(expandMoney('KES 5000', 'en'), /five thousand shillings/);
  assert.match(expandMoney('2000 bob', 'en'), /two thousand shillings/);
  assert.match(expandMoney('Ksh 1500', 'sw'), /shilingi elfu moja mia tano/);
  assert.ok(numberToSw(2000).includes('elfu'));
});

test('expandMoney ranges convert both sides', () => {
  assert.strictEqual(
    expandMoney('KSh 500-800', 'en'),
    'five hundred shillings to eight hundred shillings'
  );
  assert.strictEqual(
    expandMoney('KSh 500–800', 'en'),
    'five hundred shillings to eight hundred shillings'
  );
  assert.strictEqual(
    expandMoney('500-800 bob', 'en'),
    'five hundred shillings to eight hundred shillings'
  );
  assert.strictEqual(
    expandMoney('KSh 500-800', 'sw'),
    'shilingi mia tano hadi shilingi mia nane'
  );
});

test('expandMoney receipt shorthand /= and /-', () => {
  assert.strictEqual(
    expandMoney('1500/=', 'en'),
    'one thousand five hundred shillings'
  );
  assert.strictEqual(expandMoney('500/-', 'en'), 'five hundred shillings');
  assert.strictEqual(
    expandMoney('1500/=', 'sw'),
    'shilingi elfu moja mia tano'
  );
  assert.strictEqual(expandMoney('500/-', 'sw'), 'shilingi mia tano');
  assert.strictEqual(
    expandMoney('500-800/=', 'en'),
    'five hundred shillings to eight hundred shillings'
  );
});

test('expandBarePriceInContext only after Price:', () => {
  assert.strictEqual(
    expandBarePriceInContext('Price: 15,000', 'en'),
    'Price: fifteen thousand'
  );
  assert.strictEqual(
    expandBarePriceInContext('Price: 900', 'en'),
    'Price: nine hundred'
  );
  assert.strictEqual(
    expandBarePriceInContext('Price: 1,500-2,000', 'en'),
    'Price: one thousand five hundred to two thousand'
  );
  assert.strictEqual(
    expandSpokenForms('Price: 15,000 for 3 books', 'en'),
    'Price: fifteen thousand for 3 books'
  );
  assert.strictEqual(expandSpokenForms('3 books', 'en'), '3 books');
  assert.strictEqual(expandSpokenForms('3 items', 'en'), '3 items');
});

test('expandTimes + day ranges', () => {
  assert.match(expandTimes('Open 8am close 6:30pm', 'en'), /8 A M/);
  assert.match(expandTimes('Open 8am close 6:30pm', 'en'), /6 30 P M/);
  assert.match(expandTimes('Fungua 8am', 'sw'), /saa 8 asubuhi/);
  assert.match(expandDayRanges('Mon-Sat', 'en'), /Monday to Saturday/);
  assert.match(expandDayRanges('Mon-Sat', 'sw'), /Jumatatu hadi Jumamosi/);
});

test('expandPhones spaced Kenyan mobiles', () => {
  const spoken = '0 7 4 0 4 4 2 9 4 3';
  assert.strictEqual(expandPhones('0740442943'), spoken);
  assert.strictEqual(expandPhones('0740 442 943'), spoken);
  assert.strictEqual(expandPhones('07404 42943'), spoken);
  assert.strictEqual(expandPhones('0740-442-943'), spoken);
  assert.strictEqual(expandPhones('0712 345 678'), '0 7 1 2 3 4 5 6 7 8');
  assert.strictEqual(
    expandPhones('Call +254712345678 please'),
    'Call 2 5 4 7 1 2 3 4 5 6 7 8 please'
  );
});

test('expand24HourTime is a safety net and skips AM/PM forms', () => {
  assert.strictEqual(expand24HourTime('14:30', 'en'), '2:30 PM');
  assert.strictEqual(expand24HourTime('08:00-18:00', 'en'), '8 AM to 6 PM');
  assert.strictEqual(expand24HourTime('08:00–18:00', 'en'), '8 AM to 6 PM');
  assert.strictEqual(
    expand24HourTime('08:00-18:00', 'sw'),
    'saa 8 asubuhi hadi saa 6 jioni'
  );
  assert.strictEqual(
    expand24HourTime('14:30', 'sw'),
    'saa 2 na dakika 30 jioni'
  );
  assert.strictEqual(expand24HourTime('8 A M', 'en'), '8 A M');
  assert.strictEqual(expand24HourTime('9:00 AM', 'en'), '9:00 AM');
  assert.match(expandSpokenForms('Open 8am close 6:30pm', 'en'), /8 A M/);
  assert.match(expandSpokenForms('Open 8am close 6:30pm', 'en'), /6 30 P M/);
  assert.strictEqual(
    expandSpokenForms('Mon-Sat: 09:00-19:00 EAT', 'en'),
    'Monday to Saturday: 9 AM to 7 PM EAT'
  );
});

console.log('shengRewrite');
test('rewrites common Sheng for English TTS', () => {
  assert.ok(shouldRewriteSheng('Niaje', 'en'));
  const out = rewriteShengForTts('Niaje msee, niko poa');
  assert.match(out, /nee-ah-jay/i);
  assert.match(out, /mseh/i);
  assert.match(out, /poh-ah/i);
});

console.log('resolveTtsLanguage / prepareForTts');
test('per-utterance SW detection', () => {
  assert.strictEqual(detectUtteranceTtsLang('Sawa asante sana'), 'sw');
  assert.strictEqual(resolveTtsLanguage('Sawa asante.', 'en'), 'sw');
});

test('sticky SW + sheng ride rules', () => {
  assert.strictEqual(resolveTtsLanguage('Karibu.', 'sw'), 'sw');
  assert.strictEqual(resolveTtsLanguage('Niaje, niko poa', 'sheng'), 'en');
  assert.strictEqual(resolveTtsLanguage('Okay sure', 'mixed'), 'en');
});

test('forced language wins', () => {
  assert.strictEqual(resolveTtsLanguage('Sawa asante', 'en', 'en'), 'en');
  assert.strictEqual(resolveTtsLanguage('Hello', 'en', 'sw'), 'sw');
});

test('prepareForTts drops ASR_CORRECTION_PROMPT and RETOTI before underscore strip', () => {
  const prepared = prepareForTts(
    'ASR_CORRECTION_PROMPT: The user\'s input seems truncated or quiet. Ask for missing details or to repeat gently. RETOTI: Sawa, Alvin.',
    { callLanguage: 'sw' }
  );
  assert.doesNotMatch(prepared.text, /ASR|RETOTI|NPFALSE|truncated or quiet|repeat gently/i);
  assert.match(prepared.text, /Sawa, Alvin/);
});

test('prepareForTts drops a bare NP_FALSE token', () => {
  const prepared = prepareForTts('NP_FALSE', { callLanguage: 'en' });
  assert.strictEqual(prepared.text, '');
});

test('prepareForTts drops Speak this spelling, VISIT COMMIT, and Alvin said', () => {
  const prepared = prepareForTts(
    'Speak this spelling once in the next line. VISIT COMMIT (think this; never say it as a script): Alvin said they want carpet cleaning.',
    { callLanguage: 'en' }
  );
  assert.doesNotMatch(
    prepared.text,
    /Speak this spelling|VISIT COMMIT|think this|never say it as a script|Alvin said/i
  );
  assert.match(prepared.text, /they want carpet cleaning/i);
});

test('prepareForTts full pipeline', () => {
  const prepared = prepareForTts('Call +254712345678 about mpesa in Thika…', {
    callLanguage: 'en',
  });
  assert.strictEqual(prepared.language, 'en');
  assert.match(prepared.text, /M-Pesa/);
  assert.match(prepared.text, /Thee-kah/);
  assert.match(prepared.text, /2 5 4 7 1 2 3 4 5 6 7 8/);
  assert.ok(!prepared.text.includes('…'));
});

test('normalizeForTts legacy helper returns spoken text', () => {
  const spoken = normalizeForTts('WhatsApp me near Westlands');
  assert.match(spoken, /WhatsApp/);
  assert.match(spoken, /West-lands/);
});

test('empty input is safe', () => {
  const prepared = prepareForTts('   ');
  assert.deepStrictEqual(prepared, { original: '', text: '', language: 'en' });
});

test('exclamation becomes a period so TTS does not punch', () => {
  const prepared = prepareForTts("I'm doing well, thank you! How can I help?");
  assert.ok(!prepared.text.includes('!'));
  assert.match(prepared.text, /thank you\./);
});

test('em dash becomes a comma so TTS does not leak dash', () => {
  const prepared = prepareForTts(
    "I don't have that exact detail — we specialize in couch cleaning."
  );
  assert.ok(!/[—–]/.test(prepared.text));
  assert.match(prepared.text, /detail, we specialize/);
});

test('spaced hyphens become commas so TTS does not say hyphen', () => {
  const prepared = prepareForTts(
    'We offer sofa cleaning - carpet cleaning - mattress cleaning.',
    { callLanguage: 'en' }
  );
  assert.ok(!prepared.text.includes('-'));
  assert.match(prepared.text, /sofa cleaning, carpet cleaning, mattress cleaning/);
});

test('bullet leaks flatten to a spoken list', () => {
  const prepared = prepareForTts('Our services include: - Sofa cleaning - Carpet cleaning.', {
    callLanguage: 'en',
  });
  assert.strictEqual(prepared.text, 'Our services include: Sofa cleaning, Carpet cleaning.');
});

test('intra-word hyphens survive (lexicon say-forms need them)', () => {
  const prepared = prepareForTts('We clean check-in units near Ruiru.', { callLanguage: 'en' });
  assert.match(prepared.text, /check-in/);
  assert.match(prepared.text, /Roo-ee-roo/);
});

test('spaced dot chains collapse so TTS does not say full stop', () => {
  const prepared = prepareForTts('Wait . . . let me check.', { callLanguage: 'en' });
  assert.strictEqual(prepared.text, 'Wait. let me check.');
});

test('double period with a space collapses', () => {
  const prepared = prepareForTts('The price is 3,000. . Thank you.', { callLanguage: 'en' });
  assert.strictEqual(prepared.text, 'The price is 3,000. Thank you.');
});

test('12h time ranges expand both sides and drop the dash', () => {
  assert.strictEqual(
    prepareForTts('Visit: 3:00pm-4:00pm works.', { callLanguage: 'en' }).text,
    'Visit: 3 P M to 4 P M works.'
  );
  assert.strictEqual(
    prepareForTts('Open 3-4pm.', { callLanguage: 'en' }).text,
    'Open 3 to 4 P M.'
  );
});

test('SW 12h range keeps a single saa head', () => {
  const prepared = prepareForTts('Tunafungua saa 8am - 4pm. Sawa.', { callLanguage: 'sw' });
  assert.match(prepared.text, /saa 8 asubuhi hadi saa 4 jioni/);
  assert.ok(!/saa saa/.test(prepared.text));
});

test('e.g. and i.e. are spoken, not spelled', () => {
  assert.match(prepareForTts('e.g. sofas and rugs.', { callLanguage: 'en' }).text, /for example sofas/);
  assert.match(prepareForTts('i.e. the red one.', { callLanguage: 'en' }).text, /that is the red one/);
});

test('numbered list markers become commas, not full stops', () => {
  const prepared = prepareForTts('1. Tell me your estate 2. Pick a day.', { callLanguage: 'en' });
  assert.strictEqual(prepared.text, '1, Tell me your estate 2, Pick a day.');
});

test('thousands and decimals are not list markers', () => {
  assert.strictEqual(
    prepareForTts('It is 15,000. Thank you.', { callLanguage: 'en' }).text,
    'It is 15,000. Thank you.'
  );
});

test('HD_0ef68f8e7930 glued openers get a space before TTS', () => {
  assert.strictEqual(
    prepareForTts('Ican help with that, Alvin.', { callLanguage: 'en' }).text,
    'I can help with that, Alvin.'
  );
  assert.strictEqual(
    prepareForTts('Youhave a carpet cleaning visit requested for tomorrow at 8 AM.', {
      callLanguage: 'en',
    }).text,
    'You have a carpet cleaning visit requested for tomorrow at 8 A M.'
  );
  assert.strictEqual(
    prepareForTts('Understood,Alvin.', { callLanguage: 'en' }).text,
    'Understood, Alvin.'
  );
  assert.strictEqual(
    prepareForTts('Takeyour time, Alvin.', { callLanguage: 'en' }).text,
    'Take your time, Alvin.'
  );
  assert.strictEqual(
    prepareForTts('Iam doing well, Alvin, thank you for asking.', { callLanguage: 'en' }).text,
    'I am doing well, Alvin, thank you for asking.'
  );
});

test('and/or and ampersand speak as words', () => {
  assert.match(prepareForTts('Pay by M-Pesa and/or cash.', { callLanguage: 'en' }).text, /and or cash/);
  assert.match(prepareForTts('Done & Dusted.', { callLanguage: 'en' }).text, /Done and Dusted/);
});

test('till and paybill numbers speak digit by digit', () => {
  assert.strictEqual(
    prepareForTts('Pay to till number 5194830.', { callLanguage: 'en' }).text,
    'Pay to till number 5 1 9 4 8 3 0.'
  );
  assert.match(
    prepareForTts('Paybill 247247, account 10203040.', { callLanguage: 'en' }).text,
    /pay bill 2 4 7 2 4 7, account 1 0 2 0 3 0 4 0/
  );
});

test('order and reference numbers speak digit by digit', () => {
  assert.strictEqual(
    prepareForTts('Order number 45678.', { callLanguage: 'en' }).text,
    'Order number 4 5 6 7 8.'
  );
  assert.strictEqual(
    prepareForTts('Use reference 4521.', { callLanguage: 'en' }).text,
    'Use reference 4 5 2 1.'
  );
});

test('weak identifier keywords need 5+ digits so years survive', () => {
  assert.strictEqual(prepareForTts('Open till 2026.', { callLanguage: 'en' }).text, 'Open till 2026.');
  assert.strictEqual(prepareForTts('Open till 9pm.', { callLanguage: 'en' }).text, 'Open till 9 P M.');
});

test('compact duration ranges speak with to', () => {
  assert.strictEqual(
    prepareForTts('It takes 30-40 minutes.', { callLanguage: 'en' }).text,
    'It takes 30 to 40 minutes.'
  );
  assert.strictEqual(
    prepareForTts('Delivery in 1-2 days.', { callLanguage: 'en' }).text,
    'Delivery in 1 to 2 days.'
  );
});

test('24/7 never says slash', () => {
  assert.strictEqual(prepareForTts('We are open 24/7.', { callLanguage: 'en' }).text, 'We are open 24 7.');
});

test('quantities and shop numbers are not identifiers', () => {
  assert.strictEqual(prepareForTts('We sold 100 units.', { callLanguage: 'en' }).text, 'We sold 100 units.');
  assert.strictEqual(
    prepareForTts('Shop No. M4 on the 3rd floor.', { callLanguage: 'en' }).text,
    'Shop No. M4 on the 3rd floor.'
  );
  assert.strictEqual(prepareForTts('Can I order 2 pizzas.', { callLanguage: 'en' }).text, 'Can I order 2 pizzas.');
});

test('receipt shorthand with currency prefix never strands the code', () => {
  assert.strictEqual(prepareForTts('KSh 500/-', { callLanguage: 'en' }).text, 'five hundred shillings');
  assert.strictEqual(prepareForTts('KSh 500/=', { callLanguage: 'en' }).text, 'five hundred shillings');
  assert.strictEqual(
    prepareForTts('Bei ni Ksh 2,500/=.', { callLanguage: 'sw' }).text,
    'Bei ni shilingi elfu mbili mia tano.'
  );
});

test('k-thousands expand so money rules can claim them', () => {
  assert.strictEqual(prepareForTts('KES 5k', { callLanguage: 'en' }).text, 'five thousand shillings');
  assert.strictEqual(prepareForTts('It costs 1.5k.', { callLanguage: 'en' }).text, 'It costs 1500.');
  assert.strictEqual(prepareForTts('5km away.', { callLanguage: 'en' }).text, '5km away.');
  assert.strictEqual(prepareForTts('10kg bag.', { callLanguage: 'en' }).text, '10kg bag.');
});

test('shillings as a prefix word converts', () => {
  assert.strictEqual(
    prepareForTts('Shillings 5,000 only.', { callLanguage: 'en' }).text,
    'five thousand shillings only.'
  );
});

test('usd amounts speak as dollars with cents', () => {
  assert.strictEqual(
    prepareForTts('USD 100 per night.', { callLanguage: 'en' }).text,
    'one hundred dollars per night.'
  );
  assert.strictEqual(
    prepareForTts('$100 per night.', { callLanguage: 'en' }).text,
    'one hundred dollars per night.'
  );
  assert.strictEqual(
    prepareForTts('100 dollars per night.', { callLanguage: 'en' }).text,
    'one hundred dollars per night.'
  );
  assert.strictEqual(
    prepareForTts('USD 99.99.', { callLanguage: 'en' }).text,
    'ninety nine dollars and ninety nine cents.'
  );
});

test('cents are spoken, never truncated', () => {
  assert.strictEqual(
    prepareForTts('KSh 1,200.50', { callLanguage: 'en' }).text,
    'one thousand two hundred shillings and fifty cents'
  );
  assert.strictEqual(prepareForTts('KSh 0.50.', { callLanguage: 'en' }).text, 'fifty cents.');
  assert.strictEqual(
    prepareForTts('KSh 1,200.50', { callLanguage: 'sw' }).text,
    'shilingi elfu moja mia mbili na senti hamsini'
  );
});

test('money ranges joined with to or hadi convert both sides', () => {
  assert.strictEqual(
    prepareForTts('KSh 500 to 800.', { callLanguage: 'en' }).text,
    'five hundred shillings to eight hundred shillings.'
  );
  assert.strictEqual(
    prepareForTts('KSh 500 hadi 800.', { callLanguage: 'sw' }).text,
    'shilingi mia tano hadi shilingi mia nane.'
  );
});

test('millions speak in words', () => {
  assert.strictEqual(prepareForTts('KSh 1,000,000.', { callLanguage: 'en' }).text, 'one million shillings.');
  assert.strictEqual(
    prepareForTts('KSh 2,500,000.', { callLanguage: 'sw' }).text,
    'shilingi milioni mbili elfu mia tano.'
  );
});

test('swahili numeric clock keeps its stated period, no doubled saa', () => {
  assert.strictEqual(
    prepareForTts('Anwani na muda ni kesho saa 3:00 usiku hapo Panda.', { callLanguage: 'sw' }).text,
    'Anwani na muda ni kesho saa 3 usiku hapo Panda.'
  );
  assert.strictEqual(
    prepareForTts('Tufike saa 3:30 usiku.', { callLanguage: 'sw' }).text,
    'Tufike saa 3 na dakika 30 usiku.'
  );
  assert.strictEqual(
    prepareForTts('Kuanzia 6:00 asubuhi.', { callLanguage: 'sw' }).text,
    'Kuanzia saa 6 asubuhi.'
  );
});

test('parenthetical asides become pauses, not spoken brackets', () => {
  assert.strictEqual(
    prepareForTts('Ilikuwa ni usafishaji wa godoro (mattress cleaning) kesho.', { callLanguage: 'sw' }).text,
    'Ilikuwa ni usafishaji wa godoro, mattress cleaning, kesho.'
  );
  assert.strictEqual(
    prepareForTts('We charge KSh 500 (per person) for that.', { callLanguage: 'en' }).text,
    'We charge five hundred shillings, per person, for that.'
  );
});

test('ENDCALL leftover is not spoken if it reaches TTS prep', () => {
  const prepared = prepareForTts(
    'Have a great day. ###ENDCALL###'
  );
  assert.ok(!/endcall/i.test(prepared.text));
  assert.match(prepared.text, /Have a great day/);
});

test('Al-vin tenant say-form collapses so the name is not an extra word', () => {
  const prepared = prepareForTts(
    'Thank you for calling Done and Dusted Cleaning Services, Alvin.',
    {
      extraLexicon: [
        {
          match: 'alvin',
          say: 'Al-vin',
          langs: ['en'],
          priority: 200,
        },
      ],
    }
  );
  assert.match(prepared.text, /Alvin/);
  assert.ok(!prepared.text.includes('Al-vin'));
});

test('Air-tel keep-hyphen say-form is not joined', () => {
  assert.strictEqual(sanitizeSayForm('Air-tel'), 'Air-tel');
  assert.strictEqual(sanitizeSayForm('Al-vin'), 'Alvin');
  assert.strictEqual(sanitizeSayForm('Kris-to-fa'), 'Kris-to-fa');
});

console.log('speedForLanguage');
test('SW speed env override', () => {
  const prev = process.env.SONIOX_TTS_SPEED_SW;
  process.env.SONIOX_TTS_SPEED_SW = '0.9';
  assert.strictEqual(speedForLanguage('sw'), 0.9);
  if (prev == null) delete process.env.SONIOX_TTS_SPEED_SW;
  else process.env.SONIOX_TTS_SPEED_SW = prev;
});

test('default speaking tempo is 1.0 when SONIOX_TTS_SPEED unset', () => {
  const { spawnSync } = require('child_process');
  const script = `
    delete process.env.SONIOX_TTS_SPEED;
    delete process.env.SONIOX_TTS_SPEED_EN;
    delete process.env.SONIOX_TTS_SPEED_SW;
    delete process.env.VOICE_PROFILE;
    const { speedForLanguage } = require('./src/speech/sonioxTts');
    if (speedForLanguage('en') !== 1) process.exit(2);
    if (speedForLanguage('sw') !== 1) process.exit(3);
  `;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.strictEqual(
    r.status,
    0,
    `default TTS speed should be 1.0 (status=${r.status} stderr=${r.stderr})`
  );
});

console.log('golden fixtures');
const goldenPath = path.join(__dirname, 'fixtures', 'pronunciation.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
for (const c of golden.cases) {
  test(`golden:${c.id}`, () => {
    const prepared = prepareForTts(c.text, {
      callLanguage: c.callLanguage,
      extraLexicon: c.extraLexicon,
    });
    assert.strictEqual(
      prepared.language,
      c.expectLanguage,
      `lang for ${c.id}: got ${prepared.language}, spoken=${prepared.text}`
    );
    for (const needle of c.expectIncludes || []) {
      assert.ok(
        prepared.text.toLowerCase().includes(String(needle).toLowerCase()),
        `${c.id} missing "${needle}" in "${prepared.text}"`
      );
    }
  });
}

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed before failure path)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
