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
  it('uses one place list: Kenya area tree on Desk, legacy index for old ids only', () => {
    const tree = path.join(__dirname, '../dashboard/src/lib/data/kenyaAreaTree.v1.json');
    assert.ok(fs.existsSync(tree));
    assert.ok(!fs.existsSync(path.join(__dirname, '../dashboard/src/lib/data/kenyaPlaceCounties.json')));
    assert.ok(fs.existsSync(path.join(__dirname, '../src/conversation/data/kenyaPlaceCounties.json')));
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

  it('keeps policies as instructions only; service areas are not listed here', () => {
    const block = formatPoliciesBlock({
      delivery: 'Same day before 2pm',
      coverage_areas: ['county:nairobi', 'place:westlands'],
    });
    assert.match(block, /Same day before 2pm/);
    assert.doesNotMatch(block, /Coverage: Nairobi/);
  });
});
