const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isJunkCallerName,
  sanitizeStoredCallerName,
} = require('../src/conversation/callerNameQuality');
const { isPlausibleCallerName, extractName } = require('../src/conversation/entityExtraction');

describe('junk caller names', () => {
  it('rejects live STT placeholders', () => {
    assert.equal(isJunkCallerName('Haijawekwa'), true);
    assert.equal(isJunkCallerName('Calling'), true);
    assert.equal(isJunkCallerName('Callings'), true);
    assert.equal(isJunkCallerName('Theexact'), true);
    assert.equal(isJunkCallerName('Where'), true);
    assert.equal(sanitizeStoredCallerName('Haijawekwa'), null);
    assert.equal(sanitizeStoredCallerName('Alvin.'), 'Alvin');
    assert.equal(isPlausibleCallerName('Haijawekwa'), false);
    assert.equal(isPlausibleCallerName('Calling'), false);
    assert.equal(extractName('My name is Haijawekwa'), null);
    assert.equal(extractName('My name is Calling'), null);
    assert.equal(extractName('My name is Amina'), 'Amina');
  });
});
