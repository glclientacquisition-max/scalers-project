const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packPath = path.join(
  __dirname,
  '../dashboard/src/lib/homeServicesOnboardingPack.ts'
);

describe('home services onboarding pack', () => {
  const src = fs.readFileSync(packPath, 'utf8');

  it('seeds cleaning jobs alongside trades', () => {
    assert.match(src, /Home cleaning/);
    assert.match(src, /Carpet, upholstery, mattress/);
    assert.match(src, /General repair \/ maintenance visit/);
    assert.match(src, /Do you clean carpets/);
    assert.match(src, /Same-day cleaning is a normal visit/);
  });

  it('does not use em or en dashes in owner-facing seed copy', () => {
    assert.equal(/\u2013|\u2014/.test(src), false);
  });
});
