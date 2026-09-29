const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  formatCoverageList,
  parseCoverageAreas,
  readCoverageAreas,
  coveredByAreas,
} = require('../src/conversation/coverageAreas');
const { areasFromPlainText } = require('../dashboard/src/lib/coverageSeed');
const { formatPoliciesBlock } = require('../src/conversation/businessPolicies');

describe('coverage directory', () => {
  it('keeps the dashboard gazetteer identical to the voice copy', () => {
    const voice = fs.readFileSync(
      path.join(__dirname, '../src/conversation/data/kenyaPlaceCounties.json')
    );
    const desk = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/data/kenyaPlaceCounties.json')
    );
    assert.equal(voice.equals(desk), true);
  });

  it('keeps county and place ids and drops unknown names', () => {
    assert.deepEqual(parseCoverageAreas(['county:nairobi', 'place:westlands', 'county:nowhere', 'place:nairobi']), [
      'county:nairobi',
      'place:westlands',
    ]);
    assert.equal(readCoverageAreas({ delivery: 'Nairobi' }), null);
    assert.deepEqual(readCoverageAreas({ coverage_areas: [] }), []);
  });

  it('covers a picked county and not a neighboring estate', () => {
    const areas = ['county:nairobi'];
    assert.equal(coveredByAreas('Runda', areas), true);
    assert.equal(coveredByAreas('Ruaka', areas), false);
    assert.equal(coveredByAreas('Westlands', ['place:westlands']), true);
    assert.equal(coveredByAreas('Runda', ['place:westlands']), false);
  });

  it('reads a county or an estate out of old plain text', () => {
    assert.deepEqual(areasFromPlainText('Nairobi'), ['county:nairobi']);
    assert.deepEqual(areasFromPlainText('Nairobi CBD, same day before 2pm'), [
      'place:nairobi cbd',
    ]);
    assert.deepEqual(areasFromPlainText('Westlands and Kilimani'), [
      'place:westlands',
      'place:kilimani',
    ]);
    assert.deepEqual(areasFromPlainText('Mombasa Road'), ['place:mombasa road']);
    assert.deepEqual(areasFromPlainText('Kiambu and Ruiru'), ['county:kiambu']);
  });

  it('puts the directory on the policy block and leaves Delivery as instructions', () => {
    const block = formatPoliciesBlock({
      delivery: 'Same day before 2pm',
      coverage_areas: ['county:nairobi', 'place:westlands'],
    });
    assert.match(block, /Coverage: Nairobi, Westlands/);
    assert.match(block, /Same day before 2pm/);
    assert.match(block, /Coverage line is the only service area/);
  });
});
