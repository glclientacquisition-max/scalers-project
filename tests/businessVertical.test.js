const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseVertical,
  offeredVertical,
} = require('../src/conversation/vertical');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('business type offer', () => {
  const verticalTs = read('dashboard/src/lib/vertical.ts');
  const form = read('dashboard/src/components/TenantForm.tsx');
  const wizard = read('dashboard/src/app/onboarding/OnboardingWizard.tsx');
  const compiler = read('dashboard/src/lib/promptCompiler.ts');
  const niche = read('dashboard/src/lib/inboxNiche.ts');

  it('sells Shop and Home services only', () => {
    assert.match(verticalTs, /label: VERTICAL_LABELS.retail/);
    assert.match(verticalTs, /retail: "Shop"/);
    assert.match(verticalTs, /blurb: "Holds, stock, pickup\."/);
    assert.match(verticalTs, /blurb: "We come to you\."/);
    assert.match(verticalTs, /export type OfferedVertical = "retail" \| "home_services"/);
    assert.doesNotMatch(verticalTs, /label: "Retail \/ shop"/);
    assert.doesNotMatch(wizard, /Hotel \/ lodge \/ restaurant/);
    assert.doesNotMatch(wizard, /Other \/ general/);
    assert.match(wizard, /DEFAULT_VERTICAL/);
    assert.match(wizard, /VERTICAL_OPTIONS/);
    assert.match(wizard, /opt\.blurb/);
    assert.match(form, /verticalSettingsOptions/);
    assert.match(form, /verticalBlurb\(vertical\)/);
  });

  it('maps shop onto retail and keeps hospitality as a stored id', () => {
    assert.equal(parseVertical('shop'), 'retail');
    assert.equal(parseVertical('Shop'), 'retail');
    assert.equal(parseVertical('retail'), 'retail');
    assert.equal(parseVertical('hotel'), 'hospitality');
    assert.equal(offeredVertical('shop'), 'retail');
    assert.equal(offeredVertical('hospitality'), 'general');
    assert.equal(offeredVertical('general'), 'general');
    assert.equal(offeredVertical('home_services'), 'home_services');
  });

  it('does not compile a shop or visit job for hospitality or general', () => {
    assert.match(compiler, /owner label Shop/);
    assert.match(
      compiler,
      /If vertical is hospitality or general, do not add a RETAIL or HOME SERVICES JOB section/
    );
  });

  it('uses general Inbox copy for hospitality until reservations exist', () => {
    assert.match(niche, /parsed === "hospitality" && !HOSPITALITY_RESERVATIONS_EXIST/);
    assert.match(niche, /return NICHE.general/);
  });
});
