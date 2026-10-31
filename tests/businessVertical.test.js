const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseVertical,
  offeredVertical,
} = require('../src/conversation/vertical');
const desk = require('../dashboard/src/lib/businessType.ts');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('business type offer', () => {
  const businessTypeTs = read('dashboard/src/lib/businessType.ts');
  const form = read('dashboard/src/components/identity/IdentitySettings.tsx');
  const identityCategory = read('dashboard/src/lib/identityCategory.ts');
  const wizard = read('dashboard/src/app/onboarding/OnboardingWizard.tsx');
  const compiler = read('dashboard/src/lib/promptCompiler.ts');
  const niche = read('dashboard/src/lib/inboxNiche.ts');

  it('offers Shop, Home services, and Other business', () => {
    assert.match(businessTypeTs, /retail: "Shop"/);
    assert.match(businessTypeTs, /home_services: "Home services"/);
    assert.match(businessTypeTs, /general: "Other business"/);
    assert.doesNotMatch(wizard, /DEFAULT_VERTICAL/);
    assert.match(wizard, /BUSINESS_TYPE_OPTIONS/);
    assert.match(wizard, /useState<BusinessType \| "">\(""\)/);
    assert.match(form, /identityCategoryChoices\(storedVertical\)/);
    assert.match(identityCategory, /VERTICAL_LABELS\[vertical\]/);
    assert.match(identityCategory, /current === "hospitality"/);
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
    assert.equal(desk.resolveBusinessType({ vertical: 'hospitality' }), 'general');
  });

  it('does not compile a shop or visit job for hospitality or general', () => {
    assert.match(compiler, /owner label Shop/);
    assert.match(
      compiler,
      /If vertical is hospitality or general, do not add a RETAIL or HOME SERVICES JOB section/
    );
  });

  it('uses general Inbox copy for non-retail non-home-services types', () => {
    assert.match(niche, /resolvedType\(input\)/);
    assert.match(niche, /return NICHE.general/);
  });
});
