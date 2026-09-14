const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeCallerName,
  collectKnownCallerNames,
  collisionGroupFor,
  compactNameKey,
  matchCallerName,
  namesLikelySame,
  parseSpelledCallerName,
  pickCollisionChoice,
  preferredContactSpelling,
} = require('../src/conversation/callerNameMatch');

describe('callerNameMatch', () => {
  it('folds common STT variants onto Aisha without touching Asha', () => {
    assert.equal(canonicalizeCallerName('Isha'), 'Aisha');
    assert.equal(canonicalizeCallerName('Eisha'), 'Aisha');
    assert.equal(canonicalizeCallerName('Aiesha'), 'Aisha');
    assert.equal(canonicalizeCallerName('aisha'), 'Aisha');
    assert.equal(canonicalizeCallerName('Asha'), 'Asha');
    assert.equal(matchCallerName('Asha').canonical, 'Asha');
  });

  it('folds other Kenya given-name STT variants', () => {
    assert.equal(canonicalizeCallerName('Wanjiko'), 'Wanjiku');
    assert.equal(canonicalizeCallerName('Ameena'), 'Amina');
    assert.equal(canonicalizeCallerName('Ocheng'), 'Ochieng');
  });

  it('does not invent a name when nothing matches', () => {
    assert.equal(canonicalizeCallerName('Alvin'), 'Alvin');
    assert.equal(canonicalizeCallerName('Blorpt'), 'Blorpt');
    assert.equal(matchCallerName('Alvin'), null);
  });

  it('does not treat Jane and June as the same person', () => {
    assert.equal(namesLikelySame('Jane', 'June'), false);
    assert.equal(namesLikelySame('Asha', 'Aisha'), false);
    assert.equal(namesLikelySame('Isha', 'Aisha'), true);
    assert.equal(namesLikelySame('Amina', 'Ameena'), true);
    assert.equal(compactNameKey("Ochieng'"), 'ochieng');
  });

  it('prefers a returning-caller file name over a different Kenya exact', () => {
    const known = [{ name: 'Aisha', source: 'memory' }];
    assert.equal(
      canonicalizeCallerName('Asha', { knownNames: known, preferKnown: true }),
      'Aisha'
    );
    assert.equal(
      canonicalizeCallerName('Asha', { knownNames: known, preferKnown: false }),
      'Asha'
    );
  });

  it('joins letter-by-letter spelling', () => {
    assert.equal(parseSpelledCallerName('A I S H A'), 'Aisha');
    assert.equal(parseSpelledCallerName("It's A-I-S-H-A"), 'Aisha');
    assert.equal(parseSpelledCallerName('A, I, S, H, A'), 'Aisha');
    assert.equal(canonicalizeCallerName(parseSpelledCallerName('A I S H A')), 'Aisha');
    assert.equal(parseSpelledCallerName('My name is Aisha'), null);
  });

  it('collects file and alternate names for matching', () => {
    const names = collectKnownCallerNames({
      profile: {
        callerMemory: {
          name: 'Amina',
          greetByName: false,
          alternateNames: ['Brian'],
        },
      },
      state: { caller: { name: 'Amina' } },
    });
    assert.deepEqual(
      names.map((row) => row.name),
      ['Amina', 'Brian']
    );
  });

  it('upgrades a mangled file spelling to the Kenya canonical', () => {
    assert.equal(preferredContactSpelling('Isha', 'Aisha'), 'Aisha');
    assert.equal(preferredContactSpelling('Aisha', 'Isha'), 'Aisha');
    assert.equal(preferredContactSpelling('Jane', 'jane'), 'Jane');
  });

  it('does not silent-rewrite Colin to Collins', () => {
    assert.equal(canonicalizeCallerName('Colin'), 'Colin');
    assert.equal(canonicalizeCallerName('Collins'), 'Collins');
    assert.deepEqual(collisionGroupFor('Colin'), ['Colin', 'Collins']);
    assert.equal(pickCollisionChoice('Collins', ['Colin', 'Collins']), 'Collins');
    assert.equal(pickCollisionChoice('C O L L I N S', ['Colin', 'Collins']), 'Collins');
    assert.equal(preferredContactSpelling('Collins', 'Colin'), 'Collins');
    assert.equal(preferredContactSpelling('Colin', 'Collins'), 'Colin');
  });

  it('folds a returning-file collision near miss to the file spelling', () => {
    assert.equal(
      canonicalizeCallerName('Colin', {
        knownNames: [{ name: 'Collins', source: 'memory' }],
        preferKnown: true,
      }),
      'Collins'
    );
    assert.equal(namesLikelySame('Colin', 'Collins'), true);
    assert.equal(namesLikelySame('Jane', 'June'), false);
  });
});
