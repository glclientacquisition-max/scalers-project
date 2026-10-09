'use strict';

// HD_1677e57f73f9: the model's only name confirm, "Je, ninaongea na Chris?",
// was dropped by verifySay as privacy_unbound. A question that asks only to
// confirm the primary on-file name goes through; anything more from the file
// (a row, another name, a vocative) stays gated until the name is confirmed.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifySay } = require('../../src/speech/structured/verify');
const { gateCallerFileSpeech, isPrimaryNameConfirm } = require('../../src/speech/callerFileSpeech');
const { dustedTable } = require('./helpers');
const CALL = require('../fixtures/voice-calls/HD_1677e57f73f9.call.json');

const table = dustedTable();
const codes = (r) => r.problems.map((p) => p.code);

function masked(name = 'Chris', owner = name) {
  return {
    caller: { nameConfirmed: false, fileNameAsked: name },
    returning: {
      fileOwnerName: owner,
      hasOpenRows: true,
      openRows: [{ kind: 'visit', job: 'Carpet Cleaning', status: 'requested' }],
    },
    conversation: { turnCount: 2 },
  };
}

describe('privacy_unbound lets a confirm of the on-file name through (HD_1677e57f73f9)', () => {
  it('the replay dropped exactly that line', () => {
    const dropped = JSON.stringify(CALL);
    assert.match(dropped, /"line": ?"Je, ninaongea na Chris\?"[^}]*"reason": ?"privacy_unbound"/);
  });

  it('"Je, ninaongea na Chris?" passes verifySay while masked', () => {
    const r = verifySay('Je, ninaongea na Chris?', { locked: 'sw', table, state: masked() });
    assert.ok(!codes(r).includes('privacy_unbound'), JSON.stringify(r.problems));
  });

  const OK = [
    'Je, ninaongea na Chris?',
    'Ninaongea na Chris?',
    'Naongea na Chris?',
    'Je, nazungumza na Chris?',
    'Wewe ni Chris?',
    'Chris, ni wewe?',
    'Am I speaking with Chris?',
    'Am I talking to Chris Otieno?',
    'Is this Chris?',
    'Sorry, is this Chris?',
    'Chris, is that you?',
    'Niko na Chris?',
  ];
  for (const line of OK) {
    it(`passes: ${line}`, () => {
      assert.equal(isPrimaryNameConfirm(line, masked('Chris', 'Chris Otieno')), true);
      assert.equal(gateCallerFileSpeech(line, masked('Chris', 'Chris Otieno')).reason, 'open');
    });
  }

  const BLOCKED = [
    ['Chris, you have an open carpet cleaning request.', 'a statement from the file'],
    ['Is this Chris from Kitengela?', 'adds a place'],
    ['Ninaongea na Chris kuhusu carpet cleaning?', 'adds a row'],
    ['Ninaongea na Chr?', 'a fragment, not the name'],
    ['Ninaongea na Mary?', 'not the on-file name'],
    ['Chris?', 'a bare vocative'],
    ['Ninaongea na Chris.', 'not a question'],
    ['Is this Chris and Mary?', 'a second name'],
  ];
  for (const [line, why] of BLOCKED) {
    it(`still gated: ${line} (${why})`, () => {
      assert.equal(isPrimaryNameConfirm(line, masked('Chris', 'Chris Otieno')), false);
    });
  }

  it('with no on-file name nothing is let through by this rule', () => {
    const s = masked('', '');
    assert.equal(isPrimaryNameConfirm('Ninaongea na Chris?', s), false);
  });

  it('a vocative statement with the name is still privacy_unbound', () => {
    const r = verifySay('Chris, your carpet cleaning visit is tomorrow.', { locked: 'en', table, state: masked() });
    assert.ok(codes(r).includes('privacy_unbound'));
  });
});
