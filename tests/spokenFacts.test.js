// Spoken-facts contract with Brain: renderFactLine / renderFact
// (src/speech/spokenFacts/index.js). HD_d199dbbf6b79.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderFactLine, renderFact, spokenFactsEnabled, TEMPLATES } = require('../src/speech/spokenFacts');

const NOW = '2026-10-09T08:43:00Z'; // Friday 11:43 EAT
const at = (iso, precision = 'time') => ({ type: 'datetime', iso, tz: 'Africa/Nairobi', precision });
const SAT_9 = at('2026-10-10T06:00:00Z');
const FRI_9 = at('2026-10-09T06:00:00Z');
const ASKED = at('2026-10-08T13:47:30Z'); // Thursday 16:47 EAT
const line = (template, lang, slots) => renderFactLine({ template, lang, slots }, { now: NOW });

describe('renderFact', () => {
  it('datetime time: relative day + weekday + clock', () => {
    assert.equal(renderFact(SAT_9, 'sw', { now: NOW }), 'kesho Jumamosi, saa tatu asubuhi');
    assert.equal(renderFact(SAT_9, 'en', { now: NOW }), 'tomorrow, Saturday, at 9 AM');
    assert.equal(renderFact(SAT_9, 'sheng', { now: NOW }), 'kesho Saturday, 9 AM');
    assert.equal(renderFact(FRI_9, 'sw', { now: NOW }), 'leo Ijumaa, saa tatu asubuhi');
    assert.equal(renderFact(at('2026-10-13T06:30:00Z'), 'sw', { now: NOW }), 'Jumanne, saa tatu na nusu asubuhi');
    assert.equal(renderFact(at('2026-10-20T13:00:00Z'), 'en', { now: NOW }), 'Tuesday, 20 October, at 4 PM');
    assert.equal(renderFact(at('2026-10-20T13:00:00Z'), 'sw', { now: NOW }), 'Jumanne tarehe 20 Oktoba, saa kumi jioni');
  });
  it('datetime day precision', () => {
    assert.equal(renderFact(at('2026-10-10T06:00:00Z', 'day'), 'en', { now: NOW }), 'tomorrow, Saturday');
    assert.equal(renderFact(at('2026-10-10T06:00:00Z', 'day'), 'sw', { now: NOW }), 'kesho Jumamosi');
  });
  it('requested_at is relative', () => {
    assert.equal(renderFact(ASKED, 'sw', { now: NOW, role: 'requested_at' }), 'jana jioni');
    assert.equal(renderFact(ASKED, 'en', { now: NOW, role: 'requested_at' }), 'yesterday at 4:47 PM');
  });
  it('KES money: fixed, from, range', () => {
    assert.equal(renderFact({ type: 'money', minor: 20000, currency: 'KES' }, 'en'), '200 shillings');
    assert.equal(renderFact({ type: 'money', minor: 20000, currency: 'KES' }, 'sw'), 'shilingi mia mbili');
    assert.equal(renderFact({ type: 'money', minor: 600000, currency: 'KES', mode: 'from' }, 'sw'), 'kuanzia shilingi elfu sita');
    assert.equal(renderFact({ type: 'money', minor: 150000, max_minor: 250000, currency: 'KES', mode: 'range' }, 'en'), '1,500 to 2,500 shillings');
    assert.equal(renderFact({ type: 'money', minor: 100, currency: 'USD' }, 'en'), '');
  });
  it('count and plain strings', () => {
    assert.equal(renderFact({ type: 'count', n: 3, unit: 'room' }, 'en'), '3 rooms');
    assert.equal(renderFact({ type: 'count', n: 1, unit: 'room' }, 'en'), '1 room');
    assert.equal(renderFact({ type: 'count', n: 3, unit: 'vyumba' }, 'sw'), 'vyumba tatu');
    assert.equal(renderFact('Kitengela', 'sw'), 'Kitengela');
  });
});

describe('renderFactLine templates', () => {
  it('has the agreed templates', () => {
    assert.deepEqual(TEMPLATES.sort(), ['book_ok', 'cancel_ok', 'file_item', 'move_failed', 'move_ok', 'note_ok', 'reask_slot', 'requested_when'].sort());
  });
  it('move_ok / book_ok / cancel_ok carry the rendered times', () => {
    assert.equal(
      line('move_ok', 'sw', { service: 'carpet cleaning', from: FRI_9, to: SAT_9 }),
      'Sawa, ziara ya carpet cleaning imehamishwa kutoka leo Ijumaa, saa tatu asubuhi hadi kesho Jumamosi, saa tatu asubuhi.'
    );
    assert.equal(
      line('book_ok', 'sw', { service: 'carpet cleaning', when: SAT_9, place: 'Kitengela' }),
      'Nimehifadhi ombi la ziara ya carpet cleaning kesho Jumamosi, saa tatu asubuhi, Kitengela.'
    );
    assert.equal(
      line('book_ok', 'en', { service: 'carpet cleaning', when: SAT_9 }),
      "I've saved your carpet cleaning visit request for tomorrow, Saturday, at 9 AM."
    );
    assert.equal(line('cancel_ok', 'en', { service: 'carpet cleaning', when: SAT_9 }), "I've cancelled your carpet cleaning visit for tomorrow, Saturday, at 9 AM.");
    assert.equal(line('move_failed', 'sheng', { service: 'carpet cleaning' }), 'Sijaweza ku-move carpet cleaning visit.');
    assert.equal(line('note_ok', 'sw', {}), 'Nimeiandikia timu.');
  });
  it('file_item and requested_when', () => {
    assert.equal(line('file_item', 'en', { kind: 'visit', service: 'carpet cleaning', when: FRI_9, status: 'requested' }), 'You have a carpet cleaning visit requested for today, Friday, at 9 AM.');
    assert.equal(line('file_item', 'sw', { kind: 'quote', service: 'mansion cleaning', requested_at: at('2026-10-08T20:15:04Z') }), 'Una ombi la bei ya mansion cleaning ulilotuma jana usiku.');
    assert.equal(line('requested_when', 'sw', { service: 'carpet cleaning', requested_at: ASKED }), 'Uliomba carpet cleaning jana jioni.');
    assert.equal(line('requested_when', 'en', { service: 'carpet cleaning', requested_at: ASKED }), 'You asked for the carpet cleaning yesterday at 4:47 PM.');
    assert.equal(line('reask_slot', 'sw', { slot: 'time' }), 'Saa ngapi inakufaa?');
  });
  it('unknown template or missing slot returns null', () => {
    assert.equal(line('nope', 'en', {}), null);
    assert.equal(line('move_ok', 'en', { service: 'x', to: SAT_9 }), null);
    assert.equal(line('book_ok', 'en', { service: 'x', when: { type: 'datetime', iso: 'not a date' } }), null);
    assert.equal(line('file_item', 'en', { kind: 'thing', service: 'x' }), null);
    assert.equal(line('reask_slot', 'en', { slot: 'colour' }), null);
    assert.equal(renderFactLine(null), null);
  });
  it('flag is on only for exactly "on"', () => {
    assert.equal(spokenFactsEnabled({ VOICE_SPOKEN_FACTS: 'on' }), true);
    assert.equal(spokenFactsEnabled({ VOICE_SPOKEN_FACTS: 'true' }), false);
    assert.equal(spokenFactsEnabled({}), false);
  });
});
