const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const voice = require('../src/conversation/businessType.js');
const desk = require('../dashboard/src/lib/businessType.ts');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('business type resolver (desk + voice)', () => {
  it('prefers business_type over vertical', () => {
    assert.equal(desk.resolveBusinessType({ business_type: 'general', vertical: 'retail' }), 'general');
    assert.equal(voice.resolveBusinessType({ business_type: 'general', vertical: 'retail' }), 'general');
  });

  it('maps hospitality vertical to general', () => {
    assert.equal(desk.resolveBusinessType({ vertical: 'hospitality' }), 'general');
    assert.equal(voice.resolveBusinessType({ vertical: 'hotel' }), 'general');
  });

  it('keeps voice mirror aligned with desk exports', () => {
    const deskSrc = read('dashboard/src/lib/businessType.ts');
    const voiceSrc = read('src/conversation/businessType.js');
    for (const fn of [
      'parseBusinessType',
      'verticalToBusinessType',
      'resolveBusinessType',
      'verticalForBusinessType',
      'isHomeVisitBusinessType',
      'usesServicesCallFlow',
    ]) {
      assert.match(deskSrc, new RegExp(`export function ${fn}`));
      assert.match(voiceSrc, new RegExp(`function ${fn}`));
    }
  });
});
