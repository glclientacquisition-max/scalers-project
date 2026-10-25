'use strict';
// Bare place names (Alvin 2026-10-25 13:48 EAT): a whole-word EXACT name/alias of a place in this tenant's own
// CONFIRMED picks counts as a mention with no cue word. Fuzzy hits still need the model's understanding or a place
// slot; places outside the tenant's picks still need a cue word (else "which area?"). EN + SW.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const AC = require('../src/conversation/v2/areaCoverage');
const ML = require('../src/conversation/v2/modelLead');
const FR = require('./fixtures/dndSimTenant.json');

const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicks: FR.picks.picks, areaPicksConfirmedAt: FR.picks.confirmed_at }), id: FR.row.id };
const UNCONFIRMED = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicks: FR.picks.picks, areaPicksConfirmedAt: null }), id: FR.row.id };
const names = (t, o = {}) => AC.placeMentions(t, { profile: P, ...o }).map((m) => m.name);

test('bare "Syokimau" and "Thika, mnafika?" count (own confirmed picks)', () => {
  assert.deepEqual(names('Syokimau'), ['Syokimau']);
  assert.deepEqual(names('Thika, mnafika?'), ['Thika']);
});
test('EN/SW sentence with an own-pick name and no cue word counts (via own_pick)', () => {
  const en = AC.placeMentions('I want deep cleaning Thika on Monday', { profile: P });
  assert.deepEqual(en.map((m) => [m.name, m.via, m.fuzzy]), [['Thika', 'own_pick', false]]);
  assert.deepEqual(names('Nataka deep cleaning Syokimau Jumatatu asubuhi tafadhali'), ['Syokimau']);
  assert.equal(ML.coverageFor('I want deep cleaning Thika on Monday', P).places[0].place, 'Thika');
});
test('nipo / saa / ngapi never become places (HD_7a9915837b00)', () => {
  assert.deepEqual(names('Deep cleaning nipo saa ngapi?'), []);
  assert.deepEqual(names('nipo saa ngapi'), []);
  assert.deepEqual(ML.coverageFor('Deep cleaning nipo saa ngapi?', P).places, []);
});
test('fuzzy hits do not count bare: misspelt own pick in a sentence is not a mention', () => {
  assert.deepEqual(names('I want deep cleaning Syokimao on Monday'), []);
  assert.deepEqual(names('Nataka deep cleaning Thikka Jumatatu asubuhi'), []);
});
test('a fuzzy hit still counts when the model named the place', () => {
  const u = { slots: { places: ['Syokimau'] } };
  assert.deepEqual(names('I want deep cleaning Syokimao on Monday', { u }), ['Syokimau']);
});
test('a place NOT in the tenant picks needs a cue word', () => {
  assert.deepEqual(names('I want deep cleaning Kericho on Monday'), []);
  assert.deepEqual(names('Nataka deep cleaning Kericho Jumatatu asubuhi'), []);
  assert.deepEqual(names('Do you come to Kericho on Monday?'), ['Kericho']);
  assert.deepEqual(names('Nataka deep cleaning kwa Kericho Jumatatu'), ['Kericho']);
});
test('unconfirmed picks and no profile: no bare own-pick mention', () => {
  assert.deepEqual(AC.placeMentions('I want deep cleaning Thika on Monday', { profile: UNCONFIRMED }).map((m) => m.name), []);
  assert.deepEqual(AC.placeMentions('I want deep cleaning Thika on Monday').map((m) => m.name), []);
});
