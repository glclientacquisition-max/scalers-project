// HD_c98820e579e1 saved "not a" as an alternate name on Alvin's phone.
// On HD_23445a4f780c that junk made the line look shared, so the
// "Am I speaking with Alvin?" confirm and the caller file were skipped.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isJunkCallerName } = require('../src/conversation/callerNameQuality');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { mergeContactIdentity } = require('../src/conversation/contactIdentity');
const { callerHearingNames } = require('../src/speech/sttContext');
const {
  createBrainState,
  observeCallerTurn,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');

const JUNK = [
  'not a', 'Not a.', 'a', 'the', 'okay', 'Okay.', 'yes', 'hello', 'it is', 'I am',
  'ndiyo', 'sawa', 'hapana', 'nauliza', 'aje', 'niaje', 'poa', 'asante', 'jina langu',
  'Al', 'Jo', 'uh', 'mm', 'sir', 'Bwana', 'wait', 'it\'s me', 'thank you',
];
const REAL = ['Alvin', 'Alvin.', 'Bwana Alvin', 'Amina', 'Shy', 'Jane', 'Brian', 'Mama Amina', 'Wanjiru', 'Ali'];

function alvinContact(alternates) {
  return {
    phone: '+254700000123',
    name: 'Alvin',
    last_reason: 'carpet cleaning quote',
    metadata: { alternate_names: alternates.map((name) => ({ name })) },
  };
}

describe('junk caller names', () => {
  it('rejects function words, fillers, acks and one-or-two-letter names', () => {
    for (const name of JUNK) assert.equal(isJunkCallerName(name), true, `junk: ${name}`);
  });

  it('discourse fillers heard as a name are junk ("like", HD_1b3a67ea7ee9)', () => {
    for (const name of ['like', 'Like', 'like.', 'Like,', 'um', 'uh', 'so', 'okay', 'yes', 'no', 'sure', 'hmm', 'hmmm', 'sawa', 'ndio', 'eeh', 'well', 'actually', 'basically', 'anyway', 'maybe', 'mhm', 'yaani', 'ehe', 'like um', 'so like']) {
      assert.equal(isJunkCallerName(name), true, `junk: ${name}`);
    }
  });

  it('fillers never block a real name', () => {
    for (const name of ['Sue', 'Noah', 'Joy', 'Faith', 'Grace', 'Mercy', 'Hope', 'Wanjiku', 'Alvin', 'Liam', 'Lilian', 'Wellington', 'Maya', 'Sawe', 'Ndiomu', 'Likimani']) {
      assert.equal(isJunkCallerName(name), false, `real: ${name}`);
    }
  });

  it('keeps real names', () => {
    for (const name of REAL) assert.equal(isJunkCallerName(name), false, `real: ${name}`);
  });

  it('never saves junk as an alternate name', () => {
    const merged = mergeContactIdentity(
      { name: 'Alvin', metadata: { alternate_names: [{ name: 'okay' }] } },
      { name: 'not a', callId: 'HD_c98820e579e1' }
    );
    assert.equal(merged.name, 'Alvin');
    assert.deepEqual(merged.metadata.alternate_names, []);
  });

  it('still logs a real second person as an alternate', () => {
    const merged = mergeContactIdentity({ name: 'Alvin', metadata: {} }, { name: 'Brian' });
    assert.deepEqual(merged.metadata.alternate_names.map((r) => r.name), ['Brian']);
  });

  it('Alvin plus stored "not a" is not a shared line (read-time guard)', () => {
    const card = buildCallerMemoryCard({
      contact: alvinContact(['not a']),
      openAppointments: [],
    });
    assert.equal(card.sharedLine, false);
    assert.equal(card.greetByName, true);
    assert.deepEqual(card.alternateNames, []);
  });

  it('a real alternate still makes a shared line', () => {
    const card = buildCallerMemoryCard({ contact: alvinContact(['not a', 'Brian']) });
    assert.equal(card.sharedLine, true);
    assert.deepEqual(card.alternateNames, ['Brian']);
  });

  it('junk never reaches the STT hint list', () => {
    const card = buildCallerMemoryCard({ contact: alvinContact(['not a', 'okay']) });
    const names = callerHearingNames({
      callerMemory: { ...card, alternateNames: ['not a', 'okay', 'Brian'] },
      alternateNames: ['it is'],
    });
    assert.ok(names.includes('Alvin'));
    assert.ok(names.includes('Brian'));
    assert.ok(!names.some((n) => /^(not a|okay|it is)$/i.test(n)), names.join(','));
  });

  it('with "not a" on file, the confirm-by-name is allowed', () => {
    const card = buildCallerMemoryCard({ contact: alvinContact(['not a']) });
    const profile = { vertical: 'home_services', callerMemory: card };
    const seeded = createBrainState(profile);
    const text = 'Hello';
    const state = observeCallerTurn(seeded, {
      text,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities(text, { profile, state: seeded }),
    });
    assert.equal(state.returning.sharedLine, false);
    assert.equal(state.caller.fileNameAsked, 'Alvin');
    const prompt = formatBrainStateForPrompt(state);
    assert.match(prompt, /Am I speaking with Alvin/);
    assert.doesNotMatch(prompt, /nothing is saved for this speaker/i);
  });
});

describe('shared line needs a clearly different person', () => {
  const { distinctOtherPerson } = require('../src/conversation/callerMemory');
  const same = [
    ['Brenda Cherotich', 'Brenda Chirotits'], // misspelling, same first name
    ['Chris', 'Christopher'], // nickname / prefix
    ['Christopher', 'Chris'],
    ['Mike', 'Michael'],
    ['Alvin', 'Bwana Alvin'], // holds the primary name
    ['Alvin', 'Alvin speaking'],
    ['Wanjiru', 'Wanjirü'],
    ['Cherotich', 'Chirotits'], // edit distance
  ];
  const junk = [
    ['Alvin', 'not a'],
    ['Brenda Cherotich', 'bad'],
    ['Brenda Cherotich', 'Rudia tena'],
    ['Brenda Cherotich', 'Draft tech'],
    ['Alvin', 'okay'],
  ];
  const different = [
    ['Chris', 'Steve'],
    ['Alvin', 'Brian'],
    ['Amina', 'Brian'],
    ['Brenda Cherotich', 'Kevin Otieno'],
  ];
  it('a misspelling, nickname, or phrase holding the name is the same person', () => {
    for (const [p, a] of same) assert.equal(distinctOtherPerson(p, a), false, `${p} / ${a}`);
  });
  it('junk alternates are never another person', () => {
    for (const [p, a] of junk) assert.equal(distinctOtherPerson(p, a), false, `${p} / ${a}`);
  });
  it('a clearly different name is still another person', () => {
    for (const [p, a] of different) assert.equal(distinctOtherPerson(p, a), true, `${p} / ${a}`);
  });
  it('prod-shaped cards: no shared line for variants and junk', () => {
    const card = (name, alts) =>
      buildCallerMemoryCard({
        contact: { phone: '+254700000999', name, metadata: { alternate_names: alts.map((n) => ({ name: n })) } },
      });
    assert.equal(card('Brenda Cherotich', ['Brenda Chirotits', 'bad', 'Rudia tena', 'Draft tech']).sharedLine, false);
    assert.equal(card('Chris', ['Christopher']).sharedLine, false);
    assert.equal(card('Chris', ['Steve']).sharedLine, true);
  });
});

// Alvin's staging contact (2026-10-09) carries "impressed by your" and
// "Nauliza aje" as saved alternates. They are phrases, not names.
describe('saved alternates that are not names', () => {
  const { isSavedAlternateName } = require('../src/conversation/alternateNameQuality');
  const STAGING = ['Bwana Alvin', 'Alvin speaking', 'impressed by your', 'Nauliza aje'];

  it('drops phrases and keeps names and name phrases', () => {
    for (const name of ['impressed by your', 'Impressed by your work', 'Nauliza aje', 'I want to', 'calling about', 'not a', '']) {
      assert.equal(isSavedAlternateName(name), false, `drop: ${name}`);
    }
    for (const name of ['Bwana Alvin', 'Alvin speaking', 'Brian', 'Mama Amina', 'Brenda Chirotits', 'Kevin Otieno', 'Christopher']) {
      assert.equal(isSavedAlternateName(name), true, `keep: ${name}`);
    }
    assert.equal(isSavedAlternateName({ name: 'Brian' }), true);
    assert.equal(isSavedAlternateName({ name: 'impressed by your' }), false);
  });

  it('card keeps only Bwana Alvin and Alvin speaking, line not shared', () => {
    const card = buildCallerMemoryCard({ contact: alvinContact(STAGING), openAppointments: [] });
    assert.deepEqual(card.alternateNames, ['Bwana Alvin', 'Alvin speaking']);
    assert.equal(card.sharedLine, false);
    assert.equal(card.greetByName, true);
  });

  it('string-shaped rows are filtered the same way', () => {
    const contact = { ...alvinContact([]), metadata: { alternate_names: STAGING } };
    const card = buildCallerMemoryCard({ contact });
    assert.deepEqual(card.alternateNames, ['Bwana Alvin', 'Alvin speaking']);
  });

  it('phrases never reach the STT hints, even from a raw card', () => {
    const names = callerHearingNames({
      callerMemory: { name: 'Alvin', alternateNames: STAGING },
      alternateNames: ['impressed by your', 'Brian'],
    });
    assert.ok(names.includes('Alvin'));
    assert.ok(names.includes('Bwana Alvin'));
    assert.ok(names.includes('Alvin speaking'));
    assert.ok(names.includes('Brian'));
    assert.ok(!names.some((n) => /impressed|nauliza/i.test(n)), names.join(','));
  });

  it('a real second person beside the phrases is still a shared line', () => {
    const card = buildCallerMemoryCard({ contact: alvinContact([...STAGING, 'Brian']) });
    assert.deepEqual(card.alternateNames, ['Bwana Alvin', 'Alvin speaking', 'Brian']);
    assert.equal(card.sharedLine, true);
  });
});

// Staging contact (2026-10-09, HD_1677e57f73f9 / HD_ceba9d9b3f37): "so
// disappointed" and "Mteja" still passed as saved alternates, and "Chr" (a
// cut-off of the file name Chris) made the line look shared.
describe('saved alternates: feelings, role words and name fragments are not names', () => {
  const { isSavedAlternateName } = require('../src/conversation/alternateNameQuality');

  it('drops feeling and state phrases (en / sw / sheng)', () => {
    for (const name of [
      'so disappointed', 'So Disappointed', 'very happy', 'really sorry', 'disappointed', 'impressed',
      'quite upset', 'too busy', 'nimechoka', 'Nimechoka sana', 'sijafurahi', 'amekasirika', 'tumesikitika',
      'furaha sana', 'mbaya kabisa', 'just checking', 'niko busy',
    ]) {
      assert.equal(isSavedAlternateName(name), false, `drop: ${name}`);
    }
  });

  it('drops role and address words alone (mteja, customer, client, boss, madam, sir ...)', () => {
    for (const name of [
      'Mteja', 'mteja', 'Customer', 'the client', 'Boss', 'boss lady', 'Madam', 'Sir', 'Ma\'am', 'my friend',
      'Dada', 'Kaka', 'Rafiki', 'Mama', 'Mzee', 'the owner', 'Landlord', 'Fundi', 'Bwana', 'Mdosi', 'Mheshimiwa',
    ]) {
      assert.equal(isSavedAlternateName(name), false, `drop: ${name}`);
    }
  });

  it('drops a cut-off fragment of the primary name ("Chr" for Chris)', () => {
    assert.equal(isSavedAlternateName('Chr', { primary: 'Chris' }), false);
    assert.equal(isSavedAlternateName('Chri', { primary: 'Chris Otieno' }), false);
    assert.equal(isSavedAlternateName('Otie', { primary: 'Chris Otieno' }), false);
    // Not a prefix: a different person, or the name itself.
    assert.equal(isSavedAlternateName('Christopher', { primary: 'Chris' }), true);
    assert.equal(isSavedAlternateName('Steve', { primary: 'Chris' }), true);
    // An Array#filter index as the second argument is ignored.
    assert.deepEqual(['Steve', 'Mteja'].filter(isSavedAlternateName), ['Steve']);
  });

  it('keeps real names, names that look like a prefix or a feeling, and name phrases', () => {
    for (const name of [
      'Bwana Alvin', 'Alvin speaking', 'Mama Amina', 'Brian', 'Christopher', 'Kevin Otieno', 'Brenda Chirotits',
      'Anastasia', 'Amelia', 'Alicia', 'Nitasha', 'Imelda', 'Salama', 'Furaha', 'Happy', 'Grace', 'Joy Wanjiru',
      'Dada Wanjiku', 'Mzee Kamau', 'Ahmed', 'Mohamed', 'Fred', 'Sana Ali',
    ]) {
      assert.equal(isSavedAlternateName(name), true, `keep: ${name}`);
    }
  });

  it('card: Mteja, so disappointed and Chr do not make the line shared', () => {
    const card = buildCallerMemoryCard({
      contact: { ...alvinContact(['so disappointed', 'Mteja', 'Chr', 'Bwana Chris']), name: 'Chris' },
      openAppointments: [],
    });
    assert.deepEqual(card.alternateNames, ['Bwana Chris']);
    assert.equal(card.sharedLine, false);
  });
});
